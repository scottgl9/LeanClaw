/**
 * Scenario 10: Chat Send Flow
 * Verifies chat.send and chat.abort methods via gateway.
 * 5 tests covering valid sends, missing params, and abort.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { _initTestDatabase, storeMessage, storeChatMetadata } from '../../src/db.js';
import { openClawConnect, call } from '../helpers/client.js';
import { assertErrorShape } from '../helpers/assertions.js';

let server: GatewayServer | null = null;
let testPort = 31900;

beforeAll(() => {
  _initTestDatabase();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

/**
 * Register chat.send and chat.abort handlers on the gateway server,
 * mirroring the runtime.ts implementation but without container/queue deps.
 */
function registerChatMethods(srv: GatewayServer): void {
  srv.registerMethod('chat.send', async (params) => {
    const { chatJid, text, sender, senderName } = params as {
      chatJid?: string; text?: string; sender?: string; senderName?: string;
    };
    if (!chatJid) throw new Error('chatJid is required');
    if (!text) throw new Error('text is required');

    const msgId = `gw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    storeChatMetadata(chatJid, now);
    storeMessage({
      id: msgId,
      chat_jid: chatJid,
      sender: sender || 'gateway',
      sender_name: senderName || 'Gateway User',
      content: text,
      timestamp: now,
      is_from_me: false,
      is_bot_message: false,
    });

    return { messageId: msgId, piped: false };
  });

  srv.registerMethod('chat.abort', async (params) => {
    const { chatJid } = params as { chatJid?: string };
    if (!chatJid) throw new Error('chatJid is required');
    return { aborted: true };
  });
}

describe('Scenario 10: Chat Send Flow', () => {
  // 10.1 chat.send with valid params returns {messageId, piped}
  it('10.1 chat.send with valid params returns {messageId, piped}', async () => {
    server = await startGatewayServer(testPort);
    registerChatMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chat.send', {
      chatJid: 'test-chat@e2e',
      text: 'Hello from E2E test',
      sender: 'e2e-tester',
      senderName: 'E2E Tester',
    });

    expect(res.ok).toBe(true);
    expect(typeof res.payload.messageId).toBe('string');
    expect(res.payload.messageId.length).toBeGreaterThan(0);
    expect(typeof res.payload.piped).toBe('boolean');

    ws.close();
  });

  // 10.2 chat.send missing chatJid returns error
  it('10.2 chat.send missing chatJid returns error', async () => {
    server = await startGatewayServer(testPort);
    registerChatMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chat.send', { text: 'hello' });

    expect(res.ok).toBe(false);
    assertErrorShape(res.error);
    expect(res.error.message).toContain('chatJid');

    ws.close();
  });

  // 10.3 chat.send missing text returns error
  it('10.3 chat.send missing text returns error', async () => {
    server = await startGatewayServer(testPort);
    registerChatMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chat.send', { chatJid: 'test-chat@e2e' });

    expect(res.ok).toBe(false);
    assertErrorShape(res.error);
    expect(res.error.message).toContain('text');

    ws.close();
  });

  // 10.4 chat.abort with valid chatJid returns {aborted:true}
  it('10.4 chat.abort with valid chatJid returns {aborted:true}', async () => {
    server = await startGatewayServer(testPort);
    registerChatMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chat.abort', { chatJid: 'test-chat@e2e' });

    expect(res.ok).toBe(true);
    expect(res.payload.aborted).toBe(true);

    ws.close();
  });

  // 10.5 chat.abort missing chatJid returns error
  it('10.5 chat.abort missing chatJid returns error', async () => {
    server = await startGatewayServer(testPort);
    registerChatMethods(server);

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chat.abort', {});

    expect(res.ok).toBe(false);
    assertErrorShape(res.error);
    expect(res.error.message).toContain('chatJid');

    ws.close();
  });
});
