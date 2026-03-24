/**
 * LeanClaw Runtime
 * Core lifecycle: startup, message loop, shutdown.
 */
import { POLL_INTERVAL } from './config.js';
import { initDatabase, getAllRegisteredGroups, getRouterState, setRouterState, getNewMessages, getMessagesSince, storeChatMetadata, storeMessage } from './db.js';
import { logger } from './logger.js';
import { ensureContainerRuntimeRunning, cleanupOrphans } from './agent/container.js';
import { SessionManager } from './agent/session.js';
import { startSchedulerLoop, startHeartbeatLoop, stopSchedulerLoop, stopHeartbeatLoop } from './agent/scheduler.js';
import { GroupQueue } from './queue/group-queue.js';
import { CollisionTracker } from './queue/collision.js';
import { startGatewayServer, type GatewayServer } from './gateway/server.js';
import { setHealthProvider } from './gateway/health.js';
import { loadPlugins } from './plugins/loader.js';
import { setActiveRegistry } from './plugins/registry.js';
import { getRegisteredChannelNames } from './channels/registry.js';
import type { Channel, NewMessage, RegisteredGroup } from './types.js';

export interface RuntimeState {
  gateway: GatewayServer | null;
  queue: GroupQueue;
  sessions: SessionManager;
  collisionTracker: CollisionTracker;
  channels: Channel[];
  registeredGroups: Record<string, RegisteredGroup>;
  lastTimestamp: string;
  lastAgentTimestamp: Record<string, string>;
  messageLoopRunning: boolean;
}

let state: RuntimeState | null = null;
let shutdownInProgress = false;

export async function startRuntime(): Promise<RuntimeState> {
  logger.info('LeanClaw starting...');

  // 1. Verify Docker
  ensureContainerRuntimeRunning();
  cleanupOrphans();

  // 2. Init database
  initDatabase();

  // 3. Load state
  const registeredGroups = getAllRegisteredGroups();
  const sessions = new SessionManager();
  const lastTimestamp = getRouterState('last_timestamp') || new Date(0).toISOString();
  const lastAgentTimestampRaw = getRouterState('last_agent_timestamp');
  const lastAgentTimestamp: Record<string, string> = lastAgentTimestampRaw
    ? JSON.parse(lastAgentTimestampRaw)
    : {};

  // 4. Load plugins
  const pluginDirs = [
    process.env.LEANCLAW_PLUGIN_DIR || '',
  ].filter(Boolean);

  if (pluginDirs.length > 0) {
    const registry = await loadPlugins({ dirs: pluginDirs });
    setActiveRegistry(registry);
    logger.info({ pluginCount: registry.list().length }, 'Plugins loaded');
  }

  // 5. Start gateway
  const gateway = await startGatewayServer();

  // 6. Initialize channels (from plugins)
  const channels: Channel[] = [];
  const channelNames = getRegisteredChannelNames();
  logger.info({ channels: channelNames }, 'Registered channels');

  // 7. Create queue
  const queue = new GroupQueue();
  const collisionTracker = new CollisionTracker();

  // 8. Set health provider
  setHealthProvider(() => ({
    status: 'ok',
    uptime: process.uptime(),
    activeContainers: 0,
    queuedMessages: 0,
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    connectedChannels: channels.filter((c) => c.isConnected()).length,
  }));

  // 9. Build state
  state = {
    gateway,
    queue,
    sessions,
    collisionTracker,
    channels,
    registeredGroups,
    lastTimestamp,
    lastAgentTimestamp,
    messageLoopRunning: false,
  };

  // 10. Start scheduler
  startSchedulerLoop({
    enqueueTask: (chatJid, taskId, fn) => queue.enqueueTask(chatJid, taskId, fn),
    runTask: async () => { /* Will be wired up with container runner */ },
  });

  // 11. Start heartbeat
  startHeartbeatLoop(collisionTracker, async () => {
    logger.debug('Heartbeat tick');
  });

  // 12. Start message loop
  startMessageLoop(state);

  // 13. Register shutdown
  const shutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info('Shutting down...');

    stopSchedulerLoop();
    stopHeartbeatLoop();

    await queue.shutdown(10_000);

    for (const channel of channels) {
      try {
        await channel.disconnect();
      } catch (err) {
        logger.error({ channel: channel.name, err }, 'Error disconnecting channel');
      }
    }

    if (gateway) {
      await gateway.close();
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('LeanClaw started');
  return state;
}

function startMessageLoop(s: RuntimeState): void {
  if (s.messageLoopRunning) return;
  s.messageLoopRunning = true;

  const poll = () => {
    if (shutdownInProgress) return;

    try {
      const jids = Object.keys(s.registeredGroups);
      if (jids.length > 0) {
        const { messages, newTimestamp } = getNewMessages(
          jids,
          s.lastTimestamp,
          'Andy', // Will be configurable via ASSISTANT_NAME
        );

        if (messages.length > 0) {
          s.lastTimestamp = newTimestamp;
          setRouterState('last_timestamp', newTimestamp);

          // Group messages by JID
          const byJid = new Map<string, NewMessage[]>();
          for (const msg of messages) {
            const existing = byJid.get(msg.chat_jid) || [];
            existing.push(msg);
            byJid.set(msg.chat_jid, existing);
          }

          for (const [jid] of byJid) {
            s.queue.enqueueMessageCheck(jid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }

    setTimeout(poll, POLL_INTERVAL);
  };

  poll();
}

export function getRuntime(): RuntimeState | null {
  return state;
}
