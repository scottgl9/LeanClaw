/**
 * LeanClaw Runtime
 * Core lifecycle: startup, message loop, shutdown.
 */
import { POLL_INTERVAL, ASSISTANT_NAME } from './config.js';
import { initDatabase, getAllRegisteredGroups, getRouterState, setRouterState, getNewMessages, getAllTasks, logTaskRun, updateTask, updateTaskAfterRun } from './db.js';
import { logger } from './logger.js';
import { ensureContainerRuntimeRunning, cleanupOrphans, runContainerAgent, writeTasksSnapshot } from './agent/container.js';
import { SessionManager } from './agent/session.js';
import { startSchedulerLoop, startHeartbeatLoop, stopSchedulerLoop, stopHeartbeatLoop, computeNextRun } from './agent/scheduler.js';
import { GroupQueue } from './queue/group-queue.js';
import { CollisionTracker } from './queue/collision.js';
import { startGatewayServer, type GatewayServer } from './gateway/server.js';
import { setHealthProvider } from './gateway/health.js';
import { loadPlugins } from './plugins/loader.js';
import { setActiveRegistry } from './plugins/registry.js';
import { getRegisteredChannelNames } from './channels/registry.js';
import { getProviderContainerEnv } from './providers/base.js';
import { resolveGroupFolderPath } from './config.js';
import type { Channel, NewMessage, RegisteredGroup, ScheduledTask } from './types.js';

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
    runTask: async (task: ScheduledTask) => {
      await executeScheduledTask(task, state!);
    },
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
          ASSISTANT_NAME,
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

// --- Scheduled task execution ---

async function executeScheduledTask(task: ScheduledTask, s: RuntimeState): Promise<void> {
  const startTime = Date.now();

  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    updateTask(task.id, { status: 'paused' });
    logger.error({ taskId: task.id, groupFolder: task.group_folder, error }, 'Task has invalid group folder');
    logTaskRun({ task_id: task.id, run_at: new Date().toISOString(), duration_ms: Date.now() - startTime, status: 'error', result: null, error });
    return;
  }

  const group = Object.values(s.registeredGroups).find((g) => g.folder === task.group_folder);
  if (!group) {
    logger.error({ taskId: task.id, groupFolder: task.group_folder }, 'Group not found for task');
    logTaskRun({ task_id: task.id, run_at: new Date().toISOString(), duration_ms: Date.now() - startTime, status: 'error', result: null, error: `Group not found: ${task.group_folder}` });
    return;
  }

  logger.info({ taskId: task.id, group: task.group_folder }, 'Running scheduled task');

  const isMain = group.isMain === true;
  const tasks = getAllTasks();
  writeTasksSnapshot(task.group_folder, isMain, tasks.map((t) => ({
    id: t.id, groupFolder: t.group_folder, prompt: t.prompt,
    schedule_type: t.schedule_type, schedule_value: t.schedule_value,
    status: t.status, next_run: t.next_run,
  })));

  const sessionId = task.context_mode === 'group' ? s.sessions.getSession(task.group_folder) : undefined;
  const providerEnv = getProviderContainerEnv();

  let result: string | null = null;
  let error: string | null = null;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
        assistantName: ASSISTANT_NAME,
      },
      providerEnv,
      (proc, containerName) => {
        s.queue.registerProcess(task.chat_jid, proc, containerName, task.group_folder);
      },
    );

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      result = output.result;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;
  logTaskRun({ task_id: task.id, run_at: new Date().toISOString(), duration_ms: durationMs, status: error ? 'error' : 'success', result, error });

  const nextRun = computeNextRun(task);
  const resultSummary = error ? `Error: ${error}` : result ? result.slice(0, 200) : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
  logger.info({ taskId: task.id, durationMs }, 'Task completed');
}
