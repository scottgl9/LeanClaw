/**
 * LeanClaw Runtime
 * Core lifecycle: startup, message loop, task execution, shutdown.
 */
import { POLL_INTERVAL, ASSISTANT_NAME, IDLE_TIMEOUT, TIMEZONE, TRIGGER_PATTERN, resolveGroupFolderPath, GATEWAY_PORT, GATEWAY_HOST, CONTAINER_IMAGE, MAX_CONCURRENT_CONTAINERS, DEFAULT_PROVIDER } from './config.js';
import { initDatabase, getAllRegisteredGroups, getAllChats, getRouterState, setRouterState, getNewMessages, getMessagesSince, getAllTasks, getTaskById, createTask, deleteTask, logTaskRun, updateTask, updateTaskAfterRun, setRegisteredGroup, storeMessage, storeChatMetadata } from './db.js';
import { logger } from './logger.js';
import { ensureContainerRuntimeRunning, cleanupOrphans, runContainerAgent, writeTasksSnapshot, writeGroupsSnapshot, type ContainerOutput } from './agent/container.js';
import { SessionManager } from './agent/session.js';
import { startSchedulerLoop, startHeartbeatLoop, stopSchedulerLoop, stopHeartbeatLoop, computeNextRun } from './agent/scheduler.js';
import { GroupQueue } from './queue/group-queue.js';
import { CollisionTracker } from './queue/collision.js';
import { startGatewayServer, type GatewayServer } from './gateway/server.js';
import { makeEvent } from './gateway/protocol.js';
import { setHealthProvider } from './gateway/health.js';
import { loadPlugins } from './plugins/loader.js';
import { setActiveRegistry } from './plugins/registry.js';
import { getRegisteredChannelNames } from './channels/registry.js';
import { registerProvider, getProviderContainerEnv, listProviders } from './providers/base.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { CopilotProvider } from './providers/copilot.js';
import { formatMessages, formatOutbound, findChannel, routeOutbound } from './router.js';
import { startIpcWatcher, stopIpcWatcher } from './ipc.js';
import { loadSenderAllowlist, isTriggerAllowed } from './security/sender-allowlist.js';
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

function saveState(s: RuntimeState): void {
  setRouterState('last_timestamp', s.lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(s.lastAgentTimestamp));
}

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

  // 4. Initialize LLM providers
  const anthropic = new AnthropicProvider();
  registerProvider(anthropic);
  const copilot = new CopilotProvider();
  registerProvider(copilot);
  logger.info({
    anthropic: anthropic.isConfigured(),
    copilot: copilot.isConfigured(),
  }, 'LLM providers initialized');

  // 5. Load plugins
  const pluginDirs = [
    process.env.LEANCLAW_PLUGIN_DIR || '',
  ].filter(Boolean);

  let pluginRegistry: Awaited<ReturnType<typeof loadPlugins>> | null = null;
  if (pluginDirs.length > 0) {
    pluginRegistry = await loadPlugins({ dirs: pluginDirs });
    setActiveRegistry(pluginRegistry);
    logger.info({ pluginCount: pluginRegistry.list().length }, 'Plugins loaded');
  }

  // 6. Start gateway
  const gateway = await startGatewayServer();

  // 6b. Wire plugin tools into gateway
  if (pluginRegistry) {
    const tools = pluginRegistry.getTools();
    if (tools.length > 0) {
      gateway.setPluginTools(tools.map((t) => ({ name: t.name, description: t.description, pluginId: t.pluginId })));
      logger.info({ toolCount: tools.length }, 'Plugin tools wired into gateway');
    }
  }

  // 7. Initialize channels (from plugins)
  const channels: Channel[] = [];
  const channelNames = getRegisteredChannelNames();
  logger.info({ channels: channelNames }, 'Registered channels');

  // 8. Create queue and collision tracker
  const queue = new GroupQueue();
  const collisionTracker = new CollisionTracker();

  // 9. Set health provider
  setHealthProvider(() => ({
    status: 'ok',
    uptime: process.uptime(),
    activeContainers: 0,
    queuedMessages: 0,
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    connectedChannels: channels.filter((c) => c.isConnected()).length,
  }));

  // 10. Build state
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

  // 11. Wire gateway methods to runtime state
  gateway.registerMethod('sessions.list', async () => {
    const sessions = state!.sessions.getAllSessions();
    return Object.entries(sessions).map(([folder, id]) => ({ folder, sessionId: id }));
  });
  gateway.registerMethod('config.get', async () => ({
    gateway: { port: GATEWAY_PORT, host: GATEWAY_HOST },
    container: { image: CONTAINER_IMAGE, maxConcurrent: MAX_CONCURRENT_CONTAINERS },
    provider: DEFAULT_PROVIDER,
    assistant: ASSISTANT_NAME,
    groups: Object.keys(state!.registeredGroups).length,
  }));
  gateway.registerMethod('channels.status', async () => {
    return state!.channels.map((c) => ({
      name: c.name,
      connected: c.isConnected(),
    }));
  });
  gateway.registerMethod('cron.list', async () => {
    return getAllTasks().map((t) => ({
      id: t.id,
      group: t.group_folder,
      prompt: t.prompt.slice(0, 100),
      type: t.schedule_type,
      value: t.schedule_value,
      status: t.status,
      nextRun: t.next_run,
      lastRun: t.last_run,
    }));
  });
  gateway.registerMethod('groups.list', async () => {
    return Object.entries(state!.registeredGroups).map(([jid, g]) => ({
      jid, name: g.name, folder: g.folder, isMain: g.isMain || false,
    }));
  });
  gateway.registerMethod('providers.list', async () => {
    return listProviders().map((p) => ({
      id: p.id, name: p.name, configured: p.isConfigured(),
    }));
  });

  // Interactive methods
  gateway.registerMethod('chat.send', async (params) => {
    const { chatJid, text, sender, senderName } = params as { chatJid: string; text: string; sender?: string; senderName?: string };
    if (!chatJid || !text) throw new Error('chatJid and text are required');

    // Store the message in the database
    const msgId = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg = {
      id: msgId,
      chat_jid: chatJid,
      sender: sender || 'gateway',
      sender_name: senderName || 'Gateway User',
      content: text,
      timestamp: new Date().toISOString(),
    };
    storeChatMetadata(chatJid, msg.timestamp);
    storeMessage(msg);

    // Try to pipe to active container first, otherwise enqueue
    const sent = state!.queue.sendMessage(chatJid, text);
    if (!sent) {
      state!.queue.enqueueMessageCheck(chatJid);
    }

    return { messageId: msgId, piped: sent };
  });

  gateway.registerMethod('chat.abort', async (params) => {
    const { chatJid } = params as { chatJid: string };
    if (!chatJid) throw new Error('chatJid is required');
    state!.queue.closeStdin(chatJid);
    return { aborted: true };
  });

  gateway.registerMethod('cron.add', async (params) => {
    const { groupFolder, chatJid, prompt, scheduleType, scheduleValue, contextMode } = params as {
      groupFolder: string; chatJid: string; prompt: string;
      scheduleType: 'cron' | 'interval' | 'once'; scheduleValue: string; contextMode?: string;
    };
    if (!groupFolder || !chatJid || !prompt || !scheduleType || !scheduleValue) {
      throw new Error('groupFolder, chatJid, prompt, scheduleType, and scheduleValue are required');
    }

    const { CronExpressionParser } = await import('cron-parser');
    let nextRun: string | null = null;
    if (scheduleType === 'cron') {
      const interval = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE });
      nextRun = interval.next().toISOString();
    } else if (scheduleType === 'interval') {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) throw new Error('Invalid interval value');
      nextRun = new Date(Date.now() + ms).toISOString();
    } else if (scheduleType === 'once') {
      const date = new Date(scheduleValue);
      if (isNaN(date.getTime())) throw new Error('Invalid timestamp');
      nextRun = date.toISOString();
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createTask({
      id: taskId, group_folder: groupFolder, chat_jid: chatJid,
      prompt, schedule_type: scheduleType, schedule_value: scheduleValue,
      context_mode: (contextMode as 'group' | 'isolated') || 'isolated',
      next_run: nextRun, status: 'active', created_at: new Date().toISOString(),
    });

    state?.gateway?.broadcast(makeEvent('cron', { action: 'added', taskId }));
    return { taskId, nextRun };
  });

  gateway.registerMethod('cron.remove', async (params) => {
    const { taskId } = params as { taskId: string };
    if (!taskId) throw new Error('taskId is required');

    const task = getTaskById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    deleteTask(taskId);
    state?.gateway?.broadcast(makeEvent('cron', { action: 'removed', taskId }));
    return { removed: true };
  });

  gateway.registerMethod('cron.run', async (params) => {
    const { taskId } = params as { taskId: string };
    if (!taskId) throw new Error('taskId is required');

    const task = getTaskById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    queue.enqueueTask(task.chat_jid, task.id, () => executeScheduledTask(task, state!));
    return { queued: true };
  });

  // 12. Wire processGroupMessages to queue
  queue.setProcessMessagesFn((chatJid) => processGroupMessages(chatJid, state!));

  // 12. Start scheduler
  startSchedulerLoop({
    enqueueTask: (chatJid, taskId, fn) => queue.enqueueTask(chatJid, taskId, fn),
    runTask: async (task: ScheduledTask) => {
      await executeScheduledTask(task, state!);
    },
  });

  // 13. Start heartbeat
  startHeartbeatLoop(collisionTracker, async () => {
    logger.debug('Heartbeat tick');
  });

  // 14. Start IPC watcher
  startIpcWatcher({
    sendMessage: async (jid, text) => {
      const formatted = formatOutbound(text);
      if (formatted) await routeOutbound(channels, jid, formatted);
    },
    registeredGroups: () => state!.registeredGroups,
    registerGroup: (jid, group) => {
      setRegisteredGroup(jid, group);
      state!.registeredGroups[jid] = group;
      logger.info({ jid, folder: group.folder }, 'Group registered');
    },
    onTasksChanged: () => {
      // Broadcast task update to gateway clients
      state?.gateway?.broadcast(makeEvent('cron', { updated: true }));
      logger.debug('Tasks changed via IPC');
    },
  });

  // 15. Start message loop
  startMessageLoop(state);

  // 16. Register shutdown
  const shutdown = async () => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info('Shutting down...');

    stopSchedulerLoop();
    stopHeartbeatLoop();
    stopIpcWatcher();

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

  logger.info(`LeanClaw started (trigger: @${ASSISTANT_NAME})`);
  return state;
}

// --- Message processing ---

async function processGroupMessages(chatJid: string, s: RuntimeState): Promise<boolean> {
  const group = s.registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(s.channels, chatJid);
  const isMainGroup = group.isMain === true;

  const sinceTimestamp = s.lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        TRIGGER_PATTERN.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);

  // Advance cursor (save old for rollback on error)
  const previousCursor = s.lastAgentTimestamp[chatJid] || '';
  s.lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
  saveState(s);

  logger.info({ group: group.name, messageCount: missedMessages.length }, 'Processing messages');

  // Idle timer for closing container stdin
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      s.queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  if (channel) await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const result = await runAgent(group, prompt, chatJid, s, async (output) => {
    if (output.result) {
      const text = formatOutbound(output.result);
      if (text && channel) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      // Broadcast to gateway WebSocket clients
      s.gateway?.broadcast(makeEvent('chat', {
        chatJid,
        group: group.name,
        result: output.result?.slice(0, 500),
        status: output.status,
      }));
      resetIdleTimer();
    }
    if (output.status === 'success') {
      s.queue.notifyIdle(chatJid);
      resetIdleTimer();
    }
    if (output.status === 'error') {
      hadError = true;
    }
  });

  if (channel) await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (result === 'error' || hadError) {
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output sent, skipping cursor rollback');
      return true;
    }
    s.lastAgentTimestamp[chatJid] = previousCursor;
    saveState(s);
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  s: RuntimeState,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = s.sessions.getSession(group.folder);
  const providerEnv = getProviderContainerEnv();

  // Write snapshots for container
  const tasks = getAllTasks();
  writeTasksSnapshot(group.folder, isMain, tasks.map((t) => ({
    id: t.id, groupFolder: t.group_folder, prompt: t.prompt,
    schedule_type: t.schedule_type, schedule_value: t.schedule_value,
    status: t.status, next_run: t.next_run,
  })));
  const allChats = getAllChats();
  const availableGroups = allChats.map((c) => ({
    jid: c.jid,
    name: c.name,
    lastActivity: c.last_message_time,
    isRegistered: c.jid in s.registeredGroups,
  }));
  writeGroupsSnapshot(group.folder, isMain, availableGroups);

  // Wrap onOutput to track session ID
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          s.sessions.setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      { prompt, sessionId, groupFolder: group.folder, chatJid, isMain, assistantName: ASSISTANT_NAME },
      providerEnv,
      (proc, containerName) => s.queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      s.sessions.setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Container agent error');
      return 'error';
    }
    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

// --- Message loop ---

function startMessageLoop(s: RuntimeState): void {
  if (s.messageLoopRunning) return;
  s.messageLoopRunning = true;

  const poll = () => {
    if (shutdownInProgress) return;

    try {
      const jids = Object.keys(s.registeredGroups);
      if (jids.length > 0) {
        const { messages, newTimestamp } = getNewMessages(jids, s.lastTimestamp, ASSISTANT_NAME);

        if (messages.length > 0) {
          s.lastTimestamp = newTimestamp;
          setRouterState('last_timestamp', newTimestamp);

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

  try {
    resolveGroupFolderPath(task.group_folder);
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

  const taskResult = { value: null as string | null, error: null as string | null };

  const agentResult = await runAgent(group, task.prompt, task.chat_jid, s, async (output) => {
    if (output.result) {
      taskResult.value = output.result;
      const text = formatOutbound(output.result);
      if (text) {
        const channel = findChannel(s.channels, task.chat_jid);
        if (channel) await channel.sendMessage(task.chat_jid, text);
      }
    }
    if (output.status === 'error') {
      taskResult.error = output.error || 'Unknown error';
    }
  });

  if (agentResult === 'error' && !taskResult.error) {
    taskResult.error = 'Agent execution failed';
  }

  const durationMs = Date.now() - startTime;
  logTaskRun({ task_id: task.id, run_at: new Date().toISOString(), duration_ms: durationMs, status: taskResult.error ? 'error' : 'success', result: taskResult.value, error: taskResult.error });

  const nextRun = computeNextRun(task);
  const resultSummary = taskResult.error ? `Error: ${taskResult.error}` : taskResult.value ? taskResult.value.slice(0, 200) : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
  logger.info({ taskId: task.id, durationMs }, 'Task completed');
}
