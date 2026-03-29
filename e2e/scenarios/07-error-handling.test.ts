/**
 * Scenario 7: Error Handling & Edge Cases
 * Verifies error paths match OpenClaw error contract.
 * 8 tests covering unknown methods, throws, malformed input, rapid-fire.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, call, connectRaw, sendRaw } from '../helpers/client.js';
import { assertErrorShape } from '../helpers/assertions.js';

let server: GatewayServer | null = null;
let testPort = 31700;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario 7: Error Handling & Edge Cases', () => {
  // 7.1 Unknown method returns INVALID_REQUEST with code and message
  it('7.1 Unknown method returns INVALID_REQUEST', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await openClawConnect(testPort);

    const res = await call(ws, 'nonexistent.method');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');
    expect(res.error.message).toContain('Unknown method');

    ws.close();
  });

  // 7.2 Method handler throws — returns UNAVAILABLE error
  it('7.2 Method handler throws — returns UNAVAILABLE error', async () => {
    server = await startGatewayServer(testPort);

    // Register a method that throws
    server.registerMethod('test.throw', async () => {
      throw new Error('Intentional test error');
    });

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'test.throw');

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAVAILABLE');
    expect(res.error.message).toContain('Intentional test error');

    ws.close();
  });

  // 7.3 Malformed JSON — error response not crash
  it('7.3 Malformed JSON — error response not crash', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectRaw(testPort);

    const res = await sendRaw(ws, '{broken json!!!');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');

    // Server still alive
    const res2 = await sendRaw(ws, '{also broken');
    expect(res2.ok).toBe(false);

    ws.close();
  });

  // 7.4 Missing required params for chat.send — error thrown
  it('7.4 Missing required params for chat.send — error', async () => {
    server = await startGatewayServer(testPort);

    // Register a chat.send that validates params (mirrors runtime behavior)
    server.registerMethod('chat.send', async (params) => {
      const { chatJid, text } = params as { chatJid?: string; text?: string };
      if (!chatJid || !text) throw new Error('chatJid and text are required');
      return { messageId: 'test', piped: false };
    });

    const { ws } = await openClawConnect(testPort);

    // Missing chatJid
    const res = await call(ws, 'chat.send', { text: 'hello' });
    expect(res.ok).toBe(false);
    assertErrorShape(res.error);

    ws.close();
  });

  // 7.5 Rapid-fire 20 requests — all get responses, no dropped
  it('7.5 Rapid-fire 20 requests — all get responses', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await openClawConnect(testPort);

    const promises = Array.from({ length: 20 }, (_, i) =>
      call(ws, 'health'),
    );

    const results = await Promise.all(promises);
    expect(results.length).toBe(20);
    for (const res of results) {
      expect(res.ok).toBe(true);
    }

    ws.close();
  });

  // 7.6 Empty string message — error response
  it('7.6 Empty string message — error response', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectRaw(testPort);

    const res = await sendRaw(ws, '');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');

    ws.close();
  });

  // 7.7 Request with missing 'id' field — handled gracefully
  it('7.7 Request with missing id field — handled gracefully', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectRaw(testPort);

    // Send a request frame missing the 'id' field
    const res = await sendRaw(ws, JSON.stringify({
      type: 'req',
      method: 'health',
    }));

    // Should get an error response (INVALID_REQUEST for bad frame)
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');

    ws.close();
  });

  // 7.8 Request with missing 'method' field — handled gracefully
  it('7.8 Request with missing method field — handled gracefully', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectRaw(testPort);

    const res = await sendRaw(ws, JSON.stringify({
      type: 'req',
      id: 'no-method-1',
    }));

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');

    ws.close();
  });
});
