/**
 * Scenario 3: Method Surface Completeness
 * Verifies all methods that OpenClaw clients call are registered and return
 * compatible response shapes.
 * 34 tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, call } from '../helpers/client.js';
import { assertResponseFrame, assertErrorShape } from '../helpers/assertions.js';

let server: GatewayServer | null = null;
let testPort = 31300;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

/**
 * Helper: start server with runtime-like method stubs registered.
 * In real LeanClaw, runtime.ts registers chat.send, cron.add, etc.
 * For E2E gateway-only tests, we register minimal stubs.
 */
async function startServerWithStubs(port: number): Promise<GatewayServer> {
  const gw = await startGatewayServer(port);

  // Register methods that runtime.ts normally provides
  gw.registerMethod('chat.send', async (params) => {
    const { chatJid, text } = (params || {}) as any;
    if (!chatJid || !text) throw new Error('chatJid and text are required');
    return { messageId: `gw-${Date.now()}`, piped: false };
  });

  gw.registerMethod('chat.abort', async (params) => {
    const { chatJid } = (params || {}) as any;
    if (!chatJid) throw new Error('chatJid is required');
    return { aborted: true };
  });

  gw.registerMethod('groups.list', async () => []);

  gw.registerMethod('providers.list', async () => [
    { id: 'anthropic', name: 'Anthropic', configured: false },
    { id: 'copilot', name: 'GitHub Copilot', configured: false },
  ]);

  gw.registerMethod('cron.add', async (params) => {
    const p = (params || {}) as any;
    if (!p.groupFolder || !p.chatJid || !p.prompt || !p.scheduleType || !p.scheduleValue) {
      throw new Error('groupFolder, chatJid, prompt, scheduleType, and scheduleValue are required');
    }
    return { taskId: `task-${Date.now()}`, nextRun: new Date(Date.now() + 60000).toISOString() };
  });

  gw.registerMethod('cron.remove', async (params) => {
    const { taskId } = (params || {}) as any;
    if (!taskId) throw new Error('taskId is required');
    return { removed: true };
  });

  gw.registerMethod('cron.run', async (params) => {
    const { taskId } = (params || {}) as any;
    if (!taskId) throw new Error('taskId is required');
    return { queued: true };
  });

  return gw;
}

describe('Scenario 3: Method Surface Completeness', () => {
  // --- P0 Methods ---

  // 3.1 health
  it('3.1 health returns {ok:true, uptimeMs:number}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'health');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload.uptimeMs).toBe('number');
    expect(res.payload.uptimeMs).toBeGreaterThanOrEqual(0);

    ws.close();
  });

  // 3.2 status
  it('3.2 status returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'status');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload.uptimeMs).toBe('number');

    ws.close();
  });

  // 3.3 sessions.list
  it('3.3 sessions.list returns an array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.list');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.4 sessions.create
  it('3.4 sessions.create returns graceful response', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.create', { name: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    // Stub returns error message about auto-creation
    expect(res.payload).toBeDefined();

    ws.close();
  });

  // 3.5 sessions.patch
  it('3.5 sessions.patch returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.patch', { sessionId: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);

    ws.close();
  });

  // 3.6 sessions.delete
  it('3.6 sessions.delete returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.delete', { sessionId: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);

    ws.close();
  });

  // 3.7 sessions.send
  it('3.7 sessions.send returns response (stub redirects to chat.send)', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.send', { sessionId: 'test', text: 'hello' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    // GAP: LeanClaw returns { error: 'Use chat.send instead' }, OpenClaw would route to session
    expect(res.payload).toBeDefined();

    ws.close();
  });

  // 3.8 sessions.resolve
  it('3.8 sessions.resolve returns null or session object', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.resolve', { query: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    // Stub returns null
    expect(res.payload === null || typeof res.payload === 'object').toBe(true);

    ws.close();
  });

  // 3.9 sessions.reset
  it('3.9 sessions.reset returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.reset', { sessionId: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);

    ws.close();
  });

  // 3.10 sessions.compact
  it('3.10 sessions.compact returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'sessions.compact', { sessionId: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);

    ws.close();
  });

  // 3.11 config.get
  it('3.11 config.get returns object with config data', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'config.get');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload).toBe('object');

    ws.close();
  });

  // 3.12 config.set
  it('3.12 config.set returns graceful not-supported', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'config.set', { key: 'test', value: 'val' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(res.payload.applied).toBe(false);

    ws.close();
  });

  // 3.13 config.patch
  it('3.13 config.patch returns graceful not-supported', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'config.patch', { changes: {} });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(res.payload.applied).toBe(false);

    ws.close();
  });

  // 3.14 config.schema
  it('3.14 config.schema returns JSON schema object', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'config.schema');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload).toBe('object');
    expect(res.payload.type).toBe('object');

    ws.close();
  });

  // 3.15 channels.status
  it('3.15 channels.status returns array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'channels.status');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.16 channels.logout
  it('3.16 channels.logout returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'channels.logout', { channel: 'test' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);

    ws.close();
  });

  // 3.17 cron.list
  it('3.17 cron.list returns array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'cron.list');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.18 cron.status
  it('3.18 cron.status returns {running:boolean}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'cron.status');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload.running).toBe('boolean');

    ws.close();
  });

  // 3.19 cron.add
  it('3.19 cron.add returns {taskId, nextRun}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'cron.add', {
      groupFolder: 'test-group',
      chatJid: 'test@chat',
      prompt: 'test prompt',
      scheduleType: 'interval',
      scheduleValue: '60000',
    });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload.taskId).toBe('string');
    expect(typeof res.payload.nextRun).toBe('string');

    ws.close();
  });

  // 3.20 cron.remove
  it('3.20 cron.remove returns {removed:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'cron.remove', { taskId: 'task-123' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(res.payload.removed).toBe(true);

    ws.close();
  });

  // 3.21 cron.run
  it('3.21 cron.run returns {queued:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'cron.run', { taskId: 'task-123' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(res.payload.queued).toBe(true);

    ws.close();
  });

  // 3.22 models.list
  it('3.22 models.list returns array of {id, provider, name}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'models.list');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);
    expect(res.payload.length).toBeGreaterThan(0);
    expect(res.payload[0]).toHaveProperty('id');
    expect(res.payload[0]).toHaveProperty('provider');
    expect(res.payload[0]).toHaveProperty('name');

    ws.close();
  });

  // 3.23 groups.list
  it('3.23 groups.list returns array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'groups.list');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.24 providers.list
  it('3.24 providers.list returns array of {id, name, configured}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'providers.list');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);
    if (res.payload.length > 0) {
      expect(res.payload[0]).toHaveProperty('id');
      expect(res.payload[0]).toHaveProperty('name');
      expect(res.payload[0]).toHaveProperty('configured');
    }

    ws.close();
  });

  // 3.25 tools.catalog
  it('3.25 tools.catalog returns array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'tools.catalog');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.26 agents.list
  it('3.26 agents.list returns array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'agents.list');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.27 logs.tail
  it('3.27 logs.tail returns array', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'logs.tail');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload)).toBe(true);

    ws.close();
  });

  // 3.28 gateway.identity.get
  it('3.28 gateway.identity.get returns {name, version, runtime}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'gateway.identity.get');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(res.payload.name).toBe('LeanClaw');
    expect(typeof res.payload.version).toBe('string');
    expect(res.payload.runtime).toBe('leanclaw');

    ws.close();
  });

  // 3.29 wake
  it('3.29 wake returns {ok:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'wake');
    assertResponseFrame(res);
    expect(res.ok).toBe(true);

    ws.close();
  });

  // 3.30 send (legacy)
  it('3.30 send (legacy) routes to chat.send or returns error', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'send', { chatJid: 'test@chat', text: 'hello' });
    assertResponseFrame(res);
    // send forwards to chat.send; with our stub it should succeed
    expect(res.ok).toBe(true);
    expect(res.payload.messageId).toBeDefined();

    ws.close();
  });

  // 3.31 chat.send
  it('3.31 chat.send returns {messageId, piped}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'chat.send', { chatJid: 'test@chat', text: 'hello world' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(typeof res.payload.messageId).toBe('string');
    expect(typeof res.payload.piped).toBe('boolean');

    ws.close();
  });

  // 3.32 chat.abort
  it('3.32 chat.abort returns {aborted:true}', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'chat.abort', { chatJid: 'test@chat' });
    assertResponseFrame(res);
    expect(res.ok).toBe(true);
    expect(res.payload.aborted).toBe(true);

    ws.close();
  });

  // 3.33 system-presence (MISSING method)
  it('3.33 system-presence — documents current gap', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'system-presence');
    assertResponseFrame(res);

    // GAP: LeanClaw returns INVALID_REQUEST (Unknown method), OpenClaw would return presence map/array
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');
    // OpenClaw expected: { ok: true, payload: [...presenceEntries] }

    ws.close();
  });

  // 3.34 system-event (MISSING method)
  it('3.34 system-event — documents current gap', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'system-event', { event: 'heartbeat', ts: Date.now() });
    assertResponseFrame(res);

    // GAP: LeanClaw returns INVALID_REQUEST (Unknown method), OpenClaw would accept the beacon
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');
    // OpenClaw expected: { ok: true } (accepts periodic beacons from clients)

    ws.close();
  });
});

// --- Additional gap documentation for methods not in the 34-test surface ---

describe('Scenario 3: Additional Gap Methods', () => {
  // GAP: tools.effective — not registered in LeanClaw
  it('tools.effective — documents current gap', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'tools.effective', { sessionId: 'test' });
    // GAP: LeanClaw returns INVALID_REQUEST, OpenClaw would return session-scoped tool list
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');

    ws.close();
  });

  // GAP: agent — not registered in LeanClaw
  it('agent — documents current gap', async () => {
    server = await startServerWithStubs(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'agent', { action: 'run', sessionId: 'test' });
    // GAP: LeanClaw returns INVALID_REQUEST, OpenClaw would trigger agent run from UI
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');

    ws.close();
  });
});
