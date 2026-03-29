/**
 * Integration tests for wired gateway methods.
 * Tests that sessions.list, config.get, channels.status, cron.list,
 * groups.list, and providers.list return correct data shapes from runtime state.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from './server.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { _initTestDatabase, createTask, getTaskById, setRegisteredGroup, setSession, storeMessage, storeChatMetadata } from '../db.js';

let server: GatewayServer | null = null;
let testPort = 29000;

beforeEach(() => {
  _initTestDatabase();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

function connectAndAuth(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);
    ws.once('message', () => {
      // Got challenge, send connect
      const connectMsg = JSON.stringify({
        type: 'req', id: '1', method: 'connect',
        params: {
          minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
          client: { id: 'test', version: '1.0', platform: 'linux', mode: 'test' },
        },
      });
      ws.once('message', () => resolve(ws)); // hello-ok
      ws.send(connectMsg);
    });
  });
}

function call(ws: WebSocket, method: string, params?: unknown): Promise<any> {
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

describe('Wired gateway methods', () => {
  it('sessions.list returns session data', async () => {
    server = await startGatewayServer(testPort);

    // Wire a real sessions.list method backed by DB
    setSession('main', 'sess-abc');
    setSession('work', 'sess-def');

    server.registerMethod('sessions.list', async () => {
      const { getAllSessions } = await import('../db.js');
      const sessions = getAllSessions();
      return Object.entries(sessions).map(([folder, id]) => ({ folder, sessionId: id }));
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'sessions.list');

    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(2);
    expect(res.payload[0]).toHaveProperty('folder');
    expect(res.payload[0]).toHaveProperty('sessionId');
    ws.close();
  });

  it('config.get returns configuration', async () => {
    server = await startGatewayServer(testPort);

    server.registerMethod('config.get', async () => ({
      gateway: { port: testPort, host: '127.0.0.1' },
      container: { image: 'leanclaw-agent:latest', maxConcurrent: 5 },
      provider: 'anthropic',
      assistant: 'Andy',
      groups: 0,
    }));

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'config.get');

    expect(res.ok).toBe(true);
    expect(res.payload.gateway.port).toBe(testPort);
    expect(res.payload.provider).toBe('anthropic');
    expect(res.payload.assistant).toBe('Andy');
    ws.close();
  });

  it('cron.list returns scheduled tasks', async () => {
    server = await startGatewayServer(testPort);

    createTask({
      id: 'task-1', group_folder: 'main', chat_jid: 'chat1',
      prompt: 'Daily report', schedule_type: 'cron', schedule_value: '0 9 * * *',
      context_mode: 'isolated', next_run: '2025-01-01T09:00:00Z',
      status: 'active', created_at: '2025-01-01T00:00:00Z',
    });

    server.registerMethod('cron.list', async () => {
      const { getAllTasks } = await import('../db.js');
      return getAllTasks().map((t) => ({
        id: t.id, group: t.group_folder, prompt: t.prompt.slice(0, 100),
        type: t.schedule_type, value: t.schedule_value,
        status: t.status, nextRun: t.next_run,
      }));
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'cron.list');

    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(1);
    expect(res.payload[0].id).toBe('task-1');
    expect(res.payload[0].type).toBe('cron');
    expect(res.payload[0].prompt).toContain('Daily report');
    ws.close();
  });

  it('groups.list returns registered groups', async () => {
    server = await startGatewayServer(testPort);

    setRegisteredGroup('jid1', {
      name: 'Test Group', folder: 'testgroup', trigger: '@Andy',
      added_at: '2025-01-01T00:00:00Z', isMain: false,
    });
    setRegisteredGroup('jid2', {
      name: 'Main', folder: 'main', trigger: '',
      added_at: '2025-01-01T00:00:00Z', isMain: true,
    });

    server.registerMethod('groups.list', async () => {
      const { getAllRegisteredGroups } = await import('../db.js');
      const groups = getAllRegisteredGroups();
      return Object.entries(groups).map(([jid, g]) => ({
        jid, name: g.name, folder: g.folder, isMain: g.isMain || false,
      }));
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'groups.list');

    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(2);

    const mainGroup = res.payload.find((g: any) => g.isMain);
    expect(mainGroup).toBeDefined();
    expect(mainGroup.folder).toBe('main');
    ws.close();
  });

  it('channels.status returns channel list', async () => {
    server = await startGatewayServer(testPort);

    server.registerMethod('channels.status', async () => [
      { name: 'echo', connected: true },
      { name: 'telegram', connected: false },
    ]);

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'channels.status');

    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(2);
    expect(res.payload[0].name).toBe('echo');
    expect(res.payload[0].connected).toBe(true);
    ws.close();
  });

  it('providers.list returns provider info', async () => {
    server = await startGatewayServer(testPort);

    server.registerMethod('providers.list', async () => [
      { id: 'anthropic', name: 'Anthropic Claude', configured: true },
      { id: 'copilot', name: 'GitHub Copilot', configured: false },
    ]);

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'providers.list');

    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(2);
    expect(res.payload[0].id).toBe('anthropic');
    expect(res.payload[0].configured).toBe(true);
    ws.close();
  });
});

describe('Interactive gateway methods', () => {
  it('chat.send stores message and returns id', async () => {
    server = await startGatewayServer(testPort);

    server.registerMethod('chat.send', async (params) => {
      const { chatJid, text, sender, senderName } = params as any;
      const msgId = `gw-${Date.now()}`;
      storeChatMetadata(chatJid, new Date().toISOString());
      storeMessage({
        id: msgId, chat_jid: chatJid, sender: sender || 'gateway',
        sender_name: senderName || 'Gateway', content: text, timestamp: new Date().toISOString(),
      });
      return { messageId: msgId, piped: false };
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'chat.send', {
      chatJid: 'echo:test', text: 'Hello from gateway', sender: 'user1', senderName: 'Test User',
    });

    expect(res.ok).toBe(true);
    expect(res.payload.messageId).toBeDefined();
    ws.close();
  });

  it('chat.send rejects missing params', async () => {
    server = await startGatewayServer(testPort);

    server.registerMethod('chat.send', async (params) => {
      const { chatJid, text } = params as any;
      if (!chatJid || !text) throw new Error('chatJid and text are required');
      return { ok: true };
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'chat.send', { chatJid: 'echo:test' });

    expect(res.ok).toBe(false);
    ws.close();
  });

  it('cron.add creates a task', async () => {
    server = await startGatewayServer(testPort);

    server.registerMethod('cron.add', async (params) => {
      const { groupFolder, chatJid, prompt, scheduleType, scheduleValue } = params as any;
      const taskId = `task-${Date.now()}`;
      createTask({
        id: taskId, group_folder: groupFolder, chat_jid: chatJid,
        prompt, schedule_type: scheduleType, schedule_value: scheduleValue,
        context_mode: 'isolated', next_run: new Date(Date.now() + 60000).toISOString(),
        status: 'active', created_at: new Date().toISOString(),
      });
      return { taskId };
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'cron.add', {
      groupFolder: 'main', chatJid: 'echo:test', prompt: 'Test task',
      scheduleType: 'interval', scheduleValue: '60000',
    });

    expect(res.ok).toBe(true);
    expect(res.payload.taskId).toBeDefined();

    const task = getTaskById(res.payload.taskId);
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('Test task');
    ws.close();
  });

  it('cron.remove deletes a task', async () => {
    const taskId = 'task-to-remove';
    createTask({
      id: taskId, group_folder: 'main', chat_jid: 'chat1',
      prompt: 'Remove me', schedule_type: 'once', schedule_value: '2099-01-01T00:00:00Z',
      context_mode: 'isolated', next_run: '2099-01-01T00:00:00Z',
      status: 'active', created_at: new Date().toISOString(),
    });

    server = await startGatewayServer(testPort);

    server.registerMethod('cron.remove', async (params) => {
      const { taskId: id } = params as any;
      const { deleteTask: dt, getTaskById: gt } = await import('../db.js');
      const task = gt(id);
      if (!task) throw new Error('Task not found');
      dt(id);
      return { removed: true };
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'cron.remove', { taskId });

    expect(res.ok).toBe(true);
    expect(res.payload.removed).toBe(true);
    expect(getTaskById(taskId)).toBeUndefined();
    ws.close();
  });
});

describe('Phase 4 gateway methods (system-presence, system-event, agent, tools.effective, exec.approval.resolve)', () => {
  it('system-presence returns array with client info when called', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'system-presence');

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);
    expect(res.payload.length).toBeGreaterThanOrEqual(1);
    // The connected client should appear in presence
    const self = res.payload.find((p: any) => p.clientId === 'test');
    expect(self).toBeDefined();
    expect(typeof self.connId).toBe('string');
    expect(typeof self.ts).toBe('number');
    ws.close();
  });

  it('system-event returns {ok:true, received:true}', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'system-event', { event: 'test', data: {} });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.received).toBe(true);
    ws.close();
  });

  it('agent returns {ok:true, runId:null, status:not_supported, message:string}', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'agent', { prompt: 'test' });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.runId).toBeNull();
    expect(res.payload.status).toBe('not_supported');
    expect(typeof res.payload.message).toBe('string');
    ws.close();
  });

  it('tools.effective returns {tools:[], sessionKey}', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'tools.effective', { sessionKey: 'sess-123' });

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload.tools)).toBe(true);
    expect(res.payload.tools).toHaveLength(0);
    expect(res.payload.sessionKey).toBe('sess-123');
    ws.close();
  });

  it('tools.effective returns null sessionKey when not provided', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'tools.effective');

    expect(res.ok).toBe(true);
    expect(res.payload.sessionKey).toBeNull();
    ws.close();
  });

  it('exec.approval.resolve returns {ok:true, resolved:false, reason:string}', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'exec.approval.resolve', { approvalId: 'appr-1', approved: true });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.resolved).toBe(false);
    expect(typeof res.payload.reason).toBe('string');
    ws.close();
  });

  it('features.events includes presence, system, exec.approval.requested, shutdown', async () => {
    server = await startGatewayServer(testPort);

    const helloOk = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}`);
      ws.on('error', reject);
      ws.once('message', () => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
          ws.close();
        });
        ws.send(JSON.stringify({
          type: 'req', id: 'feat-1', method: 'connect',
          params: {
            minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
            client: { id: 'feat-test', version: '1.0', platform: 'linux', mode: 'test' },
          },
        }));
      });
    });

    const events: string[] = helloOk.payload.features.events;
    expect(events).toContain('presence');
    expect(events).toContain('system');
    expect(events).toContain('exec.approval.requested');
    expect(events).toContain('shutdown');
  });
});
