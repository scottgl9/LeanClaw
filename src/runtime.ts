/**
 * LeanClaw Runtime
 * Core lifecycle: startup, message loop, task execution, shutdown.
 */
import { randomUUID } from 'crypto';
import { POLL_INTERVAL, ASSISTANT_NAME, IDLE_TIMEOUT, TIMEZONE, TRIGGER_PATTERN, resolveGroupFolderPath, GATEWAY_PORT, GATEWAY_HOST, CONTAINER_IMAGE, MAX_CONCURRENT_CONTAINERS, DEFAULT_PROVIDER, AUTO_COMPACT, LOCAL_LLM_BASE_URL, LOCAL_LLM_API_KEY, LOCAL_LLM_MODEL, writeConfigFile } from './config.js';
import { initDatabase, getAllRegisteredGroups, getAllChats, getRouterState, setRouterState, getNewMessages, getMessagesSince, getAllTasks, getTaskById, createTask, deleteTask, logTaskRun, updateTask, updateTaskAfterRun, setRegisteredGroup, storeMessage, storeChatMetadata, logCompaction, getTaskRunLogs, createAgent, getAgentById, getAllAgents, updateAgent as dbUpdateAgent, deleteAgent as dbDeleteAgent, getAuditEvents, getProviderUsage } from './db.js';
import { logger } from './logger.js';
import { ensureContainerRuntimeRunning, cleanupOrphans, runContainerAgent, writeTasksSnapshot, writeGroupsSnapshot, type ContainerOutput } from './agent/container.js';
import { SessionManager } from './agent/session.js';
import { compactSession } from './agent/compaction.js';
import { ApprovalManager } from './agent/exec-approval.js';
import { listSkills, searchSkills, getSkillStatus, installSkill, updateSkill } from './skills/manager.js';
import { executeHooks } from './hooks/registry.js';
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
import { OpenAICompatibleProvider } from './providers/openai-compat.js';
import { formatMessages, formatOutbound, findChannel, routeOutbound } from './router.js';
import { startIpcWatcher, stopIpcWatcher } from './ipc.js';
import { loadSenderAllowlist, isTriggerAllowed } from './security/sender-allowlist.js';
import { MESSAGE_ROUTING_CONFIG } from './config.js';
import { resolveMessageRoutingModel } from './message-routing.js';
import type { AgentRun, Channel, NewMessage, RegisteredGroup, ScheduledTask } from './types.js';

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
  activeRuns: Map<string, AgentRun>;
  approvalManager: ApprovalManager | null;
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
  // Local LLM provider (OpenAI-compatible: vLLM, SGLang, llama.cpp, Ollama, etc.)
  const localLlm = new OpenAICompatibleProvider({
    id: 'local',
    name: 'Local LLM',
    baseUrl: LOCAL_LLM_BASE_URL,
    apiKey: LOCAL_LLM_API_KEY || undefined,
    defaultModel: LOCAL_LLM_MODEL || undefined,
  });
  if (localLlm.isConfigured()) {
    registerProvider(localLlm);
    // Try to discover models from the running server
    localLlm.discoverModels().catch(() => {
      // Server may not be running at startup — models will be discovered on demand
    });
  }

  logger.info({
    anthropic: anthropic.isConfigured(),
    copilot: copilot.isConfigured(),
    local: localLlm.isConfigured(),
    localBaseUrl: localLlm.isConfigured() ? LOCAL_LLM_BASE_URL : undefined,
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

  // 6b. Wire plugin tools and HTTP routes into gateway
  if (pluginRegistry) {
    const tools = pluginRegistry.getTools();
    if (tools.length > 0) {
      gateway.setPluginTools(tools.map((t) => ({ name: t.name, description: t.description, pluginId: t.pluginId })));
      logger.info({ toolCount: tools.length }, 'Plugin tools wired into gateway');
    }

    const httpRoutes = pluginRegistry.getHttpRoutes();
    if (httpRoutes.length > 0) {
      gateway.setPluginHttpRoutes(httpRoutes);
      logger.info({ routeCount: httpRoutes.length }, 'Plugin HTTP routes wired into gateway');
    }

    // Register tools.invoke gateway method for tool execution
    gateway.registerMethod('tools.invoke', async (params) => {
      const { toolName, params: toolParams } = params as { toolName: string; params?: unknown };
      if (!toolName) throw new Error('toolName is required');
      const tool = pluginRegistry!.getTools().find((t) => t.name === toolName);
      if (!tool) throw new Error(`Tool not found: ${toolName}`);
      const callId = `invoke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return await tool.execute(callId, toolParams || {});
    });
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

  // 10. Build approval manager and state
  const approvalManager = new ApprovalManager((event, payload) => {
    gateway.broadcast(makeEvent(event, payload));
  });

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
    activeRuns: new Map(),
    approvalManager,
  };

  // 11. Wire gateway methods to runtime state
  gateway.registerMethod('sessions.list', async () => {
    const allSessions = state!.sessions.getAllSessions();
    return Object.entries(allSessions).map(([folder, id]) => ({ folder, sessionId: id }));
  });

  // Session compaction
  gateway.registerMethod('sessions.compact', async (params) => {
    const { groupFolder, instructions, model } = (params || {}) as {
      groupFolder?: string; instructions?: string; model?: string;
    };
    if (!groupFolder) throw new Error('groupFolder is required');
    const result = await compactSession(state!.sessions, { groupFolder, instructions, model });
    logCompaction(result.groupFolder, result.originalTokens, result.compactedTokens, result.model);
    return result;
  });

  // Exec approval flow
  gateway.registerMethod('exec.approval.resolve', async (params) => {
    const { approvalId, approved, resolvedBy } = params as {
      approvalId: string; approved: boolean; resolvedBy?: string;
    };
    if (!approvalId) throw new Error('approvalId is required');
    if (typeof approved !== 'boolean') throw new Error('approved must be a boolean');
    const resolved = state!.approvalManager!.resolveApproval(approvalId, approved, resolvedBy);
    return { ok: true, resolved };
  });
  gateway.registerMethod('exec.approval.list', async () => {
    return state!.approvalManager!.getPending();
  });

  gateway.registerMethod('exec.approval.request', async (params) => {
    const { toolName, args, runId, clientId } = params as {
      toolName: string; args?: unknown; runId?: string; clientId?: string;
    };
    if (!toolName) throw new Error('toolName is required');
    const approvedPromise = state!.approvalManager!.requestApproval(
      toolName, args || {}, runId || randomUUID(), clientId || '',
    );
    // Don't await — return immediately with the pending approval info
    const pending = state!.approvalManager!.getPending();
    const latest = pending.find((a) => a.toolName === toolName);
    return { ok: true, approvalId: latest?.id, status: 'pending' };
  });

  gateway.registerMethod('exec.approval.waitDecision', async (params) => {
    const { approvalId, timeout } = params as { approvalId: string; timeout?: number };
    if (!approvalId) throw new Error('approvalId is required');
    const result = await state!.approvalManager!.waitForDecision(approvalId, timeout);
    return result;
  });

  gateway.registerMethod('exec.approvals.get', async () => {
    return state!.approvalManager!.getPending();
  });

  gateway.registerMethod('exec.approvals.set', async (params) => {
    const { approvalIds, approved, resolvedBy } = params as {
      approvalIds: string[]; approved: boolean; resolvedBy?: string;
    };
    if (!approvalIds || !Array.isArray(approvalIds)) throw new Error('approvalIds array is required');
    if (typeof approved !== 'boolean') throw new Error('approved must be a boolean');
    const count = state!.approvalManager!.batchResolve(approvalIds, approved, resolvedBy);
    return { ok: true, resolvedCount: count };
  });

  // Skills system
  gateway.registerMethod('skills.bins', async () => {
    const skills = listSkills();
    return {
      bins: skills.map((s) => ({ name: s.name, version: s.version, dir: s.dir })),
      version: '0.1.0',
    };
  });
  gateway.registerMethod('skills.status', async (params) => {
    const { name } = (params || {}) as { name?: string };
    if (name) return getSkillStatus(name);
    return listSkills();
  });
  gateway.registerMethod('skills.search', async (params) => {
    const { query } = (params || {}) as { query?: string };
    return searchSkills(query || '');
  });
  gateway.registerMethod('skills.install', async (params) => {
    const { source } = params as { source: string };
    if (!source) throw new Error('source is required');
    return installSkill(source);
  });
  gateway.registerMethod('skills.update', async (params) => {
    const { name } = params as { name: string };
    if (!name) throw new Error('name is required');
    return updateSkill(name);
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

  // Dynamic models.list from all providers
  gateway.registerMethod('models.list', async () => {
    const models: Array<{ id: string; provider: string; name: string }> = [];
    for (const p of listProviders()) {
      if (!p.isConfigured()) continue;
      if ('listModels' in p && typeof (p as OpenAICompatibleProvider).listModels === 'function') {
        models.push(...(p as OpenAICompatibleProvider).listModels());
      } else if (p.id === 'anthropic') {
        models.push(
          { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6' },
          { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6' },
          { id: 'claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5' },
        );
      } else if (p.id === 'copilot') {
        models.push({ id: 'copilot', provider: 'copilot', name: 'GitHub Copilot' });
      }
    }
    return models;
  });

  // --- Session methods ---
  gateway.registerMethod('sessions.abort', async (params) => {
    const { chatJid } = (params || {}) as { chatJid?: string };
    if (!chatJid) throw new Error('chatJid is required');
    state!.queue.closeStdin(chatJid);
    state?.gateway?.broadcast(makeEvent('session.aborted', { chatJid }));
    return { ok: true, aborted: true };
  });

  gateway.registerMethod('sessions.preview', async (params) => {
    const { chatJid, limit } = (params || {}) as { chatJid?: string; limit?: number };
    if (!chatJid) throw new Error('chatJid is required');
    const messages = getMessagesSince(chatJid, '', ASSISTANT_NAME, limit || 20);
    return messages.map((m) => ({
      id: m.id, sender: m.sender, senderName: m.sender_name,
      content: m.content?.slice(0, 500), timestamp: m.timestamp,
    }));
  });

  gateway.registerMethod('sessions.usage', async (params) => {
    const { groupFolder } = (params || {}) as { groupFolder?: string };
    if (groupFolder) {
      return getProviderUsage(groupFolder);
    }
    // Aggregate across all groups
    const allGroups = Object.values(state!.registeredGroups);
    const usage: Record<string, { inputTokens: number; outputTokens: number }> = {};
    for (const g of allGroups) {
      const groupUsage = getProviderUsage(g.folder);
      for (const u of groupUsage) {
        const key = u.provider;
        if (!usage[key]) usage[key] = { inputTokens: 0, outputTokens: 0 };
        usage[key].inputTokens += u.inputTokens;
        usage[key].outputTokens += u.outputTokens;
      }
    }
    return usage;
  });

  // Session subscriptions (in-memory per-connection tracking)
  const sessionSubscriptions = new Map<string, Set<string>>();
  const messageSubscriptions = new Map<string, Set<string>>();

  gateway.registerMethod('sessions.subscribe', async (params, clientId) => {
    const { sessionKey } = (params || {}) as { sessionKey?: string };
    if (!sessionKey) throw new Error('sessionKey is required');
    if (!sessionSubscriptions.has(clientId)) sessionSubscriptions.set(clientId, new Set());
    sessionSubscriptions.get(clientId)!.add(sessionKey);
    return { ok: true };
  });

  gateway.registerMethod('sessions.unsubscribe', async (params, clientId) => {
    const { sessionKey } = (params || {}) as { sessionKey?: string };
    if (!sessionKey) throw new Error('sessionKey is required');
    sessionSubscriptions.get(clientId)?.delete(sessionKey);
    return { ok: true };
  });

  gateway.registerMethod('sessions.messages.subscribe', async (params, clientId) => {
    const { sessionKey } = (params || {}) as { sessionKey?: string };
    if (!sessionKey) throw new Error('sessionKey is required');
    if (!messageSubscriptions.has(clientId)) messageSubscriptions.set(clientId, new Set());
    messageSubscriptions.get(clientId)!.add(sessionKey);
    return { ok: true };
  });

  gateway.registerMethod('sessions.messages.unsubscribe', async (params, clientId) => {
    const { sessionKey } = (params || {}) as { sessionKey?: string };
    if (!sessionKey) throw new Error('sessionKey is required');
    messageSubscriptions.get(clientId)?.delete(sessionKey);
    return { ok: true };
  });

  // --- Config mutations ---
  gateway.registerMethod('config.set', async (params) => {
    const p = (params || {}) as Record<string, unknown>;
    try {
      writeConfigFile(p as any);
      state?.gateway?.broadcast(makeEvent('config.changed', { source: 'gateway' }));
      return { applied: true };
    } catch (err) {
      return { applied: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  gateway.registerMethod('config.patch', async (params) => {
    const p = (params || {}) as Record<string, unknown>;
    try {
      writeConfigFile(p as any);
      state?.gateway?.broadcast(makeEvent('config.changed', { source: 'gateway' }));
      return { applied: true };
    } catch (err) {
      return { applied: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- Cron enhancements ---
  gateway.registerMethod('cron.update', async (params) => {
    const { taskId, ...updates } = (params || {}) as { taskId: string } & Partial<Pick<import('./types.js').ScheduledTask, 'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'>>;
    if (!taskId) throw new Error('taskId is required');
    const task = getTaskById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    updateTask(taskId, updates);
    state?.gateway?.broadcast(makeEvent('cron', { action: 'updated', taskId }));
    return { ok: true, taskId };
  });

  gateway.registerMethod('cron.runs', async (params) => {
    const { taskId, limit } = (params || {}) as { taskId?: string; limit?: number };
    if (!taskId) throw new Error('taskId is required');
    return getTaskRunLogs(taskId, limit || 50);
  });

  // --- Agent CRUD ---
  gateway.registerMethod('agents.list', async () => {
    return getAllAgents();
  });

  gateway.registerMethod('agents.create', async (params) => {
    const { id, name, description, model, systemPrompt, tools } = (params || {}) as {
      id?: string; name?: string; description?: string; model?: string; systemPrompt?: string; tools?: string;
    };
    if (!id || !name) throw new Error('id and name are required');
    const agent = createAgent({ id, name, description, model, system_prompt: systemPrompt, tools });
    return agent;
  });

  gateway.registerMethod('agents.update', async (params) => {
    const { id, name, description, model, systemPrompt, tools } = (params || {}) as {
      id?: string; name?: string; description?: string; model?: string; systemPrompt?: string; tools?: string;
    };
    if (!id) throw new Error('id is required');
    const updates: Record<string, string | undefined> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (model !== undefined) updates.model = model;
    if (systemPrompt !== undefined) updates.system_prompt = systemPrompt;
    if (tools !== undefined) updates.tools = tools;
    const ok = dbUpdateAgent(id, updates);
    if (!ok) throw new Error(`Agent not found: ${id}`);
    return { ok: true, id };
  });

  gateway.registerMethod('agents.delete', async (params) => {
    const { id } = (params || {}) as { id?: string };
    if (!id) throw new Error('id is required');
    const ok = dbDeleteAgent(id);
    if (!ok) throw new Error(`Agent not found: ${id}`);
    return { ok: true, id };
  });

  // --- Tools effective (returns plugin tools, optionally filtered) ---
  gateway.registerMethod('tools.effective', async (params) => {
    const { sessionKey, agentId } = (params || {}) as { sessionKey?: string; agentId?: string };
    const allTools = gateway.getPluginToolsCatalog();

    // If agentId specified, filter by agent's tool whitelist
    if (agentId) {
      const agent = getAgentById(agentId);
      if (agent?.tools) {
        const allowed = new Set(agent.tools.split(',').map((t) => t.trim()));
        return {
          tools: allTools.filter((t) => allowed.has(t.name)),
          sessionKey: sessionKey || null,
        };
      }
    }

    return { tools: allTools, sessionKey: sessionKey || null };
  });

  // --- Logs ---
  gateway.registerMethod('logs.tail', async (params) => {
    const { limit } = (params || {}) as { limit?: number };
    return getAuditEvents(limit || 50);
  });

  // --- Agent execution method (replaces stub in server.ts) ---
  gateway.registerMethod('agent', async (params, clientId) => {
    const { prompt, groupFolder, chatJid, sessionKey, model, deliver } = params as {
      prompt?: string;
      groupFolder?: string;
      chatJid?: string;
      sessionKey?: string;
      model?: string;
      deliver?: boolean;
    };

    if (!prompt) throw new Error('prompt is required');

    const runId = randomUUID();
    const resolvedFolder = groupFolder || 'gateway';
    const resolvedJid = chatJid || `gateway-${clientId}`;

    // Find or create a synthetic group for gateway-initiated runs
    let group = Object.values(state!.registeredGroups).find((g) => g.folder === resolvedFolder);
    if (!group) {
      group = {
        name: resolvedFolder,
        folder: resolvedFolder,
        trigger: ASSISTANT_NAME,
        added_at: new Date().toISOString(),
        isMain: resolvedFolder === 'main',
      };
    }

    const agentRun: AgentRun = {
      runId,
      groupFolder: resolvedFolder,
      chatJid: resolvedJid,
      clientId: clientId || '',
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    state!.activeRuns.set(runId, agentRun);

    // Spawn agent asynchronously — return runId immediately
    (async () => {
      try {
        const result = await runAgent(group!, prompt, resolvedJid, state!, async (output) => {
          // Stream agent output events to connected clients
          state?.gateway?.broadcast(makeEvent('agent', {
            runId,
            type: 'output',
            text: output.result?.slice(0, 2000) || '',
            status: output.status,
          }));
        });

        const run = state!.activeRuns.get(runId);
        if (run) {
          run.status = result === 'success' ? 'completed' : 'error';
          if (result === 'error') run.error = 'Agent execution failed';
          state?.gateway?.broadcast(makeEvent('agent', {
            runId,
            type: run.status === 'completed' ? 'complete' : 'error',
            status: run.status,
            error: run.error,
          }));
        }
      } catch (err) {
        const run = state!.activeRuns.get(runId);
        if (run) {
          run.status = 'error';
          run.error = err instanceof Error ? err.message : String(err);
          state?.gateway?.broadcast(makeEvent('agent', {
            runId,
            type: 'error',
            status: 'error',
            error: run.error,
          }));
        }
      }
    })();

    return { ok: true, runId, status: 'running' };
  });

  // --- Agent wait method ---
  gateway.registerMethod('agent.wait', async (params) => {
    const { runId, timeout } = params as { runId: string; timeout?: number };
    if (!runId) throw new Error('runId is required');

    const maxWait = Math.min(timeout || 30000, 120000);
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      const run = state!.activeRuns.get(runId);
      if (!run) return { ok: false, error: `Run not found: ${runId}` };
      if (run.status === 'completed') return { ok: true, runId, status: 'completed', result: run.result };
      if (run.status === 'error') return { ok: false, runId, status: 'error', error: run.error };
      await new Promise((r) => setTimeout(r, 500));
    }

    return { ok: false, runId, status: 'timeout', error: 'Agent did not complete within timeout' };
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

    await executeHooks('on_gateway_shutdown', {});
    stopSchedulerLoop();
    stopHeartbeatLoop();
    stopIpcWatcher();
    state?.approvalManager?.clear();

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

  // 17. Fire startup hooks
  await executeHooks('on_gateway_startup', { port: GATEWAY_PORT, host: GATEWAY_HOST });

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

  // Resolve model via keyword-based message routing (pre-turn, zero LLM cost)
  const lastMessageText = missedMessages[missedMessages.length - 1]?.content ?? '';
  const routedModel = resolveMessageRoutingModel(MESSAGE_ROUTING_CONFIG, lastMessageText);
  if (routedModel) {
    logger.info({ group: group.name, model: routedModel }, 'Message routing: using routed model');
  }

  // Advance cursor (save old for rollback on error)
  const previousCursor = s.lastAgentTimestamp[chatJid] || '';
  s.lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
  saveState(s);

  logger.info({ group: group.name, messageCount: missedMessages.length }, 'Processing messages');
  await executeHooks('before_message', { chatJid, group: group.name, messageCount: missedMessages.length });

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
  }, routedModel);

  if (channel) await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);
  await executeHooks('after_message', { chatJid, group: group.name, hadError });

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

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 2000;

function isTransientError(error: string | undefined): boolean {
  if (!error) return false;
  return /rate.?limit|429|529|overloaded|temporary|timeout|ECONNRESET|ECONNREFUSED/i.test(error);
}

async function runAgentWithRetry(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  s: RuntimeState,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await runAgent(group, prompt, chatJid, s, onOutput);
    if (result === 'success') return 'success';

    // For first attempt, don't retry — runAgent handles context overflow internally
    if (attempt === 0) {
      lastError = 'first attempt failed';
      // Only retry on transient errors
      // We need to check the error from the last container run
      // For now, proceed to retry logic
    }

    if (attempt < MAX_RETRIES) {
      const delay = BASE_RETRY_DELAY * Math.pow(2, attempt) + Math.random() * 1000;
      logger.warn({ group: group.name, attempt: attempt + 1, delay: Math.round(delay) }, 'Retrying agent after transient error');
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.error({ group: group.name, maxRetries: MAX_RETRIES }, 'Agent failed after all retries');
  return 'error';
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  s: RuntimeState,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  model?: string,
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

  await executeHooks('before_agent_run', { group: group.name, groupFolder: group.folder, chatJid });

  try {
    const output = await runContainerAgent(
      group,
      { prompt, sessionId, groupFolder: group.folder, chatJid, isMain, assistantName: ASSISTANT_NAME, model },
      providerEnv,
      (proc, containerName) => s.queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      s.sessions.setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      // Auto-compact on context overflow and retry once
      if (output.contextOverflow && AUTO_COMPACT) {
        logger.info({ group: group.name }, 'Context overflow detected, attempting auto-compaction');
        try {
          const compactionResult = await compactSession(s.sessions, { groupFolder: group.folder });
          logCompaction(compactionResult.groupFolder, compactionResult.originalTokens, compactionResult.compactedTokens, compactionResult.model);
          logger.info({ group: group.name, reduction: `${Math.round((1 - compactionResult.compactedTokens / compactionResult.originalTokens) * 100)}%` }, 'Auto-compaction complete, retrying agent');

          // Retry with compacted session
          const retryOutput = await runContainerAgent(
            group,
            { prompt, sessionId: s.sessions.getSession(group.folder), groupFolder: group.folder, chatJid, isMain, assistantName: ASSISTANT_NAME, model },
            providerEnv,
            (proc, containerName) => s.queue.registerProcess(chatJid, proc, containerName, group.folder),
            wrappedOnOutput,
          );

          if (retryOutput.newSessionId) {
            s.sessions.setSession(group.folder, retryOutput.newSessionId);
          }

          if (retryOutput.status === 'error') {
            logger.error({ group: group.name, error: retryOutput.error }, 'Container agent error after compaction retry');
            return 'error';
          }
          return 'success';
        } catch (compErr) {
          logger.error({ group: group.name, err: compErr }, 'Auto-compaction failed');
        }
      }

      logger.error({ group: group.name, error: output.error }, 'Container agent error');
      return 'error';
    }
    await executeHooks('after_agent_run', { group: group.name, groupFolder: group.folder, status: 'success' });
    return 'success';
  } catch (err) {
    await executeHooks('after_agent_run', { group: group.name, groupFolder: group.folder, status: 'error', error: String(err) });
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
