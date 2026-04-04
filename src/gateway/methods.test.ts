/**
 * Integration tests for wired gateway methods.
 * Tests that sessions.list, config.get, channels.status, cron.list,
 * groups.list, and providers.list return correct data shapes from runtime state.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from './server.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { _initTestDatabase, createTask, getTaskById, setRegisteredGroup, setSession, storeMessage, storeChatMetadata, logTaskRun, createAgent, getAllAgents, getAgentById, deleteAgent, logAuditEvent, getAuditEvents } from '../db.js';

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

  it('device.token.rotate returns new UUID deviceToken', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'device.token.rotate');

    expect(res.ok).toBe(true);
    expect(typeof res.payload.deviceToken).toBe('string');
    expect(res.payload.deviceToken).toMatch(/^[0-9a-f]{8}-/);
    expect(typeof res.payload.rotatedAt).toBe('number');

    // Each call should return a different token
    const res2 = await call(ws, 'device.token.rotate');
    expect(res2.payload.deviceToken).not.toBe(res.payload.deviceToken);
    ws.close();
  });

  it('device.token.revoke returns {ok:true, revoked:true}', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'device.token.revoke', { deviceToken: 'some-token' });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.revoked).toBe(true);
    ws.close();
  });

  it('skills.bins returns {bins:[], version:string}', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'skills.bins');

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload.bins)).toBe(true);
    expect(res.payload.bins).toHaveLength(0);
    expect(res.payload.version).toBe('0.0.0');
    ws.close();
  });

  it('POST /health returns 405 Method Not Allowed', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('features.methods includes device.token.rotate, device.token.revoke, skills.bins', async () => {
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
          type: 'req', id: 'feat-methods', method: 'connect',
          params: {
            minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
            client: { id: 'feat-test', version: '1.0', platform: 'linux', mode: 'test' },
          },
        }));
      });
    });

    const methodsList: string[] = helloOk.payload.features.methods;
    expect(methodsList).toContain('device.token.rotate');
    expect(methodsList).toContain('device.token.revoke');
    expect(methodsList).toContain('skills.bins');
  });

  it('features.events includes presence, system, exec.approval.requested, shutdown, node events', async () => {
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
    expect(events).toContain('node.connected');
    expect(events).toContain('node.disconnected');
    expect(events).toContain('node.invoke.request');
  });
});

describe('Node gateway methods', () => {
  it('node.list returns empty array with no nodes', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.list');

    expect(res.ok).toBe(true);
    expect(res.payload).toEqual([]);
    ws.close();
  });

  it('node.describe returns error for unknown nodeId', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.describe', { nodeId: 'unknown' });

    expect(res.ok).toBe(true);
    expect(res.payload.error).toBeDefined();
    ws.close();
  });

  it('node.rename returns false for unknown nodeId', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.rename', { nodeId: 'unknown', displayName: 'test' });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(false);
    ws.close();
  });

  it('node.invoke returns error for unknown node', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.invoke', { nodeId: 'unknown', command: 'test' });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(false);
    expect(res.payload.error).toContain('not connected');
    ws.close();
  });

  it('node.event returns false for unknown node', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.event', { nodeId: 'unknown', event: 'test' });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(false);
    ws.close();
  });

  it('node.pair.request creates pairing request', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.pair.request', { deviceId: 'dev-1', displayName: 'My Phone' });

    expect(res.ok).toBe(true);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.requestId).toBeDefined();
    expect(res.payload.status).toBe('pending');
    ws.close();
  });

  it('node.pair.list returns pending requests', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);

    await call(ws, 'node.pair.request', { deviceId: 'dev-1' });
    const res = await call(ws, 'node.pair.list');

    expect(res.ok).toBe(true);
    expect(res.payload.pending).toHaveLength(1);
    expect(res.payload.pending[0].deviceId).toBe('dev-1');
    ws.close();
  });

  it('node.pair.approve approves pending request', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);

    const reqRes = await call(ws, 'node.pair.request', { deviceId: 'dev-1' });
    const res = await call(ws, 'node.pair.approve', { requestId: reqRes.payload.requestId });

    expect(res.ok).toBe(true);
    expect(res.payload.approved).toBe(true);
    ws.close();
  });

  it('node.pair.reject removes pending request', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);

    const reqRes = await call(ws, 'node.pair.request', { deviceId: 'dev-1' });
    await call(ws, 'node.pair.reject', { requestId: reqRes.payload.requestId });

    const listRes = await call(ws, 'node.pair.list');
    expect(listRes.payload.pending).toHaveLength(0);
    ws.close();
  });

  it('node.pair.verify returns false for non-connected node', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'node.pair.verify', { deviceId: 'unknown' });

    expect(res.ok).toBe(true);
    expect(res.payload.verified).toBe(false);
    ws.close();
  });

  it('node.pending.enqueue + drain round-trip', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);

    const enqRes = await call(ws, 'node.pending.enqueue', {
      nodeId: 'node-1', type: 'status.request', payload: { key: 'val' },
    });
    expect(enqRes.ok).toBe(true);
    expect(enqRes.payload.ok).toBe(true);
    expect(enqRes.payload.deduped).toBe(false);

    const drainRes = await call(ws, 'node.pending.drain', { nodeId: 'node-1' });
    expect(drainRes.ok).toBe(true);
    expect(drainRes.payload.items).toHaveLength(1);
    expect(drainRes.payload.items[0].type).toBe('status.request');

    // Queue should be empty after drain
    const drainRes2 = await call(ws, 'node.pending.drain', { nodeId: 'node-1' });
    expect(drainRes2.payload.items).toHaveLength(0);
    ws.close();
  });

  it('node.pending.ack removes item', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAndAuth(testPort);

    const enqRes = await call(ws, 'node.pending.enqueue', {
      nodeId: 'node-1', type: 'test',
    });
    const itemId = enqRes.payload.itemId;

    const ackRes = await call(ws, 'node.pending.ack', { nodeId: 'node-1', itemId });
    expect(ackRes.ok).toBe(true);
    expect(ackRes.payload.ok).toBe(true);
    ws.close();
  });

  it('node role connect registers in node registry and appears in node.list', async () => {
    server = await startGatewayServer(testPort);

    // Connect as a node
    const nodeWs = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${testPort}`);
      ws.on('error', reject);
      ws.once('message', () => {
        ws.once('message', () => resolve(ws));
        ws.send(JSON.stringify({
          type: 'req', id: '1', method: 'connect',
          params: {
            minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
            client: { id: 'node-device-1', version: '1.0', platform: 'linux', mode: 'node', displayName: 'Test Node' },
            role: 'node',
            caps: ['screen'],
            commands: ['system.run'],
            device: { id: 'device-abc', publicKey: 'pk', signature: 'sig', signedAt: Date.now(), nonce: 'n' },
          },
        }));
      });
    });

    // Connect as operator and check node.list
    const opWs = await connectAndAuth(testPort);
    const res = await call(opWs, 'node.list');

    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(1);
    expect(res.payload[0].nodeId).toBe('device-abc');
    expect(res.payload[0].displayName).toBe('Test Node');
    expect(res.payload[0].caps).toContain('screen');

    nodeWs.close();
    opWs.close();
  });

  it('features.methods includes node methods', async () => {
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

    const methods: string[] = helloOk.payload.features.methods;
    expect(methods).toContain('node.list');
    expect(methods).toContain('node.describe');
    expect(methods).toContain('node.rename');
    expect(methods).toContain('node.invoke');
    expect(methods).toContain('node.invoke.result');
    expect(methods).toContain('node.event');
    expect(methods).toContain('node.pair.request');
    expect(methods).toContain('node.pair.list');
    expect(methods).toContain('node.pair.approve');
    expect(methods).toContain('node.pair.reject');
    expect(methods).toContain('node.pair.verify');
    expect(methods).toContain('node.pending.enqueue');
    expect(methods).toContain('node.pending.drain');
    expect(methods).toContain('node.pending.pull');
    expect(methods).toContain('node.pending.ack');
  });
});

describe('Phase 4 gateway method gaps', () => {
  it('sessions.preview returns messages', async () => {
    server = await startGatewayServer(testPort);

    storeChatMetadata('chat1', new Date().toISOString());
    storeMessage({ id: 'msg1', chat_jid: 'chat1', sender: 'user', sender_name: 'User', content: 'Hello', timestamp: new Date().toISOString() });

    server.registerMethod('sessions.preview', async (params) => {
      const { chatJid, limit } = (params || {}) as any;
      const { getMessagesSince } = await import('../db.js');
      return getMessagesSince(chatJid, '', 'Andy', limit || 20).map((m) => ({
        id: m.id, sender: m.sender, content: m.content?.slice(0, 500), timestamp: m.timestamp,
      }));
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'sessions.preview', { chatJid: 'chat1' });
    expect(res.ok).toBe(true);
    expect(res.payload.length).toBeGreaterThanOrEqual(1);
    expect(res.payload[0].content).toBe('Hello');
    ws.close();
  });

  it('cron.update modifies task', async () => {
    createTask({
      id: 'task-upd', group_folder: 'main', chat_jid: 'chat1',
      prompt: 'Original', schedule_type: 'cron', schedule_value: '0 9 * * *',
      context_mode: 'isolated', next_run: '2025-01-01T09:00:00Z',
      status: 'active', created_at: new Date().toISOString(),
    });

    server = await startGatewayServer(testPort);
    server.registerMethod('cron.update', async (params) => {
      const { taskId, ...updates } = params as any;
      const { updateTask: ut, getTaskById: gt } = await import('../db.js');
      if (!gt(taskId)) throw new Error('not found');
      ut(taskId, updates);
      return { ok: true, taskId };
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'cron.update', { taskId: 'task-upd', prompt: 'Updated' });
    expect(res.ok).toBe(true);

    const task = getTaskById('task-upd');
    expect(task!.prompt).toBe('Updated');
    ws.close();
  });

  it('cron.runs returns run history', async () => {
    createTask({
      id: 'task-runs', group_folder: 'main', chat_jid: 'chat1',
      prompt: 'Test', schedule_type: 'once', schedule_value: '2025-01-01T00:00:00Z',
      context_mode: 'isolated', next_run: null, status: 'completed', created_at: new Date().toISOString(),
    });
    logTaskRun({ task_id: 'task-runs', run_at: new Date().toISOString(), duration_ms: 1234, status: 'success', result: 'Done', error: null });

    server = await startGatewayServer(testPort);
    server.registerMethod('cron.runs', async (params) => {
      const { taskId, limit } = params as any;
      const { getTaskRunLogs } = await import('../db.js');
      return getTaskRunLogs(taskId, limit || 50);
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'cron.runs', { taskId: 'task-runs' });
    expect(res.ok).toBe(true);
    expect(res.payload).toHaveLength(1);
    expect(res.payload[0].duration_ms).toBe(1234);
    expect(res.payload[0].status).toBe('success');
    ws.close();
  });

  it('agents.create + agents.list round-trip', async () => {
    server = await startGatewayServer(testPort);
    server.registerMethod('agents.create', async (params) => {
      const { id, name, description, model } = params as any;
      return createAgent({ id, name, description, model });
    });
    server.registerMethod('agents.list', async () => getAllAgents());

    const ws = await connectAndAuth(testPort);
    const createRes = await call(ws, 'agents.create', { id: 'agent-1', name: 'Test Agent', description: 'A test', model: 'claude-sonnet-4-6' });
    expect(createRes.ok).toBe(true);
    expect(createRes.payload.id).toBe('agent-1');

    const listRes = await call(ws, 'agents.list');
    expect(listRes.ok).toBe(true);
    expect(listRes.payload).toHaveLength(1);
    expect(listRes.payload[0].name).toBe('Test Agent');
    ws.close();
  });

  it('agents.delete removes agent', async () => {
    createAgent({ id: 'agent-del', name: 'Delete Me' });

    server = await startGatewayServer(testPort);
    server.registerMethod('agents.delete', async (params) => {
      const { id } = params as any;
      const { deleteAgent: da } = await import('../db.js');
      const ok = da(id);
      if (!ok) throw new Error('not found');
      return { ok: true, id };
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'agents.delete', { id: 'agent-del' });
    expect(res.ok).toBe(true);
    expect(getAgentById('agent-del')).toBeUndefined();
    ws.close();
  });

  it('logs.tail returns audit entries', async () => {
    logAuditEvent({ timestamp: new Date().toISOString(), event_type: 'access', actor: 'user1', target: 'gateway', details: '{}', outcome: 'success' });

    server = await startGatewayServer(testPort);
    server.registerMethod('logs.tail', async (params) => {
      const { limit } = (params || {}) as any;
      return getAuditEvents(limit || 50);
    });

    const ws = await connectAndAuth(testPort);
    const res = await call(ws, 'logs.tail', { limit: 10 });
    expect(res.ok).toBe(true);
    expect(res.payload.length).toBeGreaterThanOrEqual(1);
    expect(res.payload[0].event_type).toBe('access');
    ws.close();
  });
});
