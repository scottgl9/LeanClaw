/**
 * Scenario C: Chaos & Failure Injection
 * Verifies the gateway handles errors, garbage, rapid-fire requests,
 * and abrupt disconnections gracefully.
 * 6 tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, call, connectRaw } from '../helpers/client.js';

let server: GatewayServer | null = null;
let testPort = 32100;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario C: Chaos & Failure Injection', () => {
  // C.1 Method handler that throws an Error — returns UNAVAILABLE
  it('C.1 Handler that throws Error returns UNAVAILABLE', async () => {
    server = await startGatewayServer(testPort);
    server.registerMethod('chaos.throw-error', async () => {
      throw new Error('intentional test error');
    });

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chaos.throw-error');

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAVAILABLE');
    expect(res.error.message).toContain('intentional test error');

    ws.close();
  });

  // C.2 Method handler that throws a non-Error — returns UNAVAILABLE
  it('C.2 Handler that throws non-Error returns UNAVAILABLE', async () => {
    server = await startGatewayServer(testPort);
    server.registerMethod('chaos.throw-string', async () => {
      throw 'string error'; // eslint-disable-line no-throw-literal
    });

    const { ws } = await openClawConnect(testPort);
    const res = await call(ws, 'chaos.throw-string');

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAVAILABLE');

    ws.close();
  });

  // C.3 Multiple clients, one sends garbage, others unaffected
  it('C.3 Garbage from one client does not affect others', async () => {
    server = await startGatewayServer(testPort);

    // Connect two good clients first
    const { ws: ws1 } = await openClawConnect(testPort);
    const { ws: ws2 } = await openClawConnect(testPort);

    // Connect a raw client and send garbage text
    const { ws: garbageWs } = await connectRaw(testPort);
    garbageWs.send('not json at all {{{{');
    garbageWs.send('{"broken":');
    // Small delay to let server process garbage
    await new Promise((r) => setTimeout(r, 100));

    // Good clients should still work fine
    const res1 = await call(ws1, 'health');
    expect(res1.ok).toBe(true);

    const res2 = await call(ws2, 'health');
    expect(res2.ok).toBe(true);

    garbageWs.close();
    ws1.close();
    ws2.close();
  });

  // C.4 Client sends 100 rapid requests — all 100 get responses
  it('C.4 100 rapid requests all get responses', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await openClawConnect(testPort);

    const promises: Promise<any>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(call(ws, 'health'));
    }

    const results = await Promise.all(promises);
    expect(results.length).toBe(100);
    for (const res of results) {
      expect(res.ok).toBe(true);
    }

    ws.close();
  });

  // C.5 Server close while request in flight — client gets close or error
  it('C.5 Server close while request in flight — client gets close event', async () => {
    server = await startGatewayServer(testPort);

    // Register a slow method
    server.registerMethod('chaos.slow', async () => {
      await new Promise((r) => setTimeout(r, 10000));
      return { ok: true };
    });

    const { ws } = await openClawConnect(testPort);

    // Race: send request and close server nearly simultaneously
    const closePromise = new Promise<{ closed: true }>((resolve) => {
      ws.once('close', () => resolve({ closed: true }));
    });

    // Send the request (don't await)
    const reqId = `req-chaos-${Date.now()}`;
    ws.send(JSON.stringify({ type: 'req', id: reqId, method: 'chaos.slow' }));

    // Close server while request is in flight
    await server.close();
    server = null;

    // Client should get close event
    const result = await closePromise;
    expect(result.closed).toBe(true);
  });

  // C.6 Client disconnects mid-handshake — server cleans up
  it('C.6 Client disconnect mid-handshake — no leaked clients', async () => {
    server = await startGatewayServer(testPort);

    // Connect raw (receives challenge but never sends connect)
    const { ws: rawWs } = await connectRaw(testPort);

    // Verify client is tracked
    expect(server.getClients().size).toBe(1);

    // Disconnect immediately
    rawWs.close();

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 200));

    // Should be cleaned up
    expect(server.getClients().size).toBe(0);
  });
});
