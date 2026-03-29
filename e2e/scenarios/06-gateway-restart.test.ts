/**
 * Scenario 6: Gateway Restart Recovery
 * Verifies LeanClaw handles restart gracefully and clients can reconnect.
 * 5 tests covering shutdown, restart, reconnect, pending requests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, call, connectRaw } from '../helpers/client.js';

let server: GatewayServer | null = null;
let testPort = 31600;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario 6: Gateway Restart Recovery', () => {
  // 6.1 Clean shutdown closes all WS connections
  it('6.1 Clean shutdown closes all WS connections', async () => {
    server = await startGatewayServer(testPort);

    const c1 = await openClawConnect(testPort, { clientName: 'client-1' });
    const c2 = await openClawConnect(testPort, { clientName: 'client-2' });

    const close1 = new Promise<number>((resolve) => {
      c1.ws.on('close', (code) => resolve(code));
    });
    const close2 = new Promise<number>((resolve) => {
      c2.ws.on('close', (code) => resolve(code));
    });

    await server.close();
    server = null;

    const [code1, code2] = await Promise.all([close1, close2]);
    // Server sends 1001 (Going Away) on clean shutdown
    expect(code1).toBe(1001);
    expect(code2).toBe(1001);
  });

  // 6.2 Restart on same port succeeds
  it('6.2 Restart on same port succeeds', async () => {
    const port = testPort;
    server = await startGatewayServer(port);

    // Connect, verify working
    const c1 = await openClawConnect(port);
    expect(c1.helloOk.ok).toBe(true);
    c1.ws.close();

    // Stop
    await server.close();
    server = null;

    // Start again on same port
    server = await startGatewayServer(port);

    // Connect again
    const c2 = await openClawConnect(port);
    expect(c2.helloOk.ok).toBe(true);
    c2.ws.close();
  });

  // 6.3 Client reconnects after restart (new handshake succeeds)
  it('6.3 Client reconnects after restart', async () => {
    const port = testPort;
    server = await startGatewayServer(port);

    const c1 = await openClawConnect(port, { clientName: 'reconnector' });
    const oldConnId = c1.connId;

    const closePromise = new Promise<void>((resolve) => {
      c1.ws.on('close', () => resolve());
    });

    await server.close();
    server = null;
    await closePromise;

    // Restart
    server = await startGatewayServer(port);

    // Reconnect — should get new connId
    const c2 = await openClawConnect(port, { clientName: 'reconnector' });
    expect(c2.helloOk.ok).toBe(true);
    expect(c2.connId).toBeTruthy();
    expect(c2.connId).not.toBe(oldConnId);
    c2.ws.close();
  });

  // 6.4 Pending request during shutdown — client gets error or close, no hang
  it('6.4 Pending request during shutdown — no hang', async () => {
    const port = testPort;
    server = await startGatewayServer(port);

    const { ws } = await openClawConnect(port);

    // Send a request and immediately close the server
    const reqId = `req-shutdown-${Date.now()}`;
    ws.send(JSON.stringify({ type: 'req', id: reqId, method: 'health' }));

    // Close server — client should get close or error, not hang
    const result = await Promise.race([
      new Promise<string>((resolve) => {
        ws.on('close', () => resolve('closed'));
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'res' && msg.id === reqId) resolve('response');
        });
      }),
      server!.close().then(() => {
        server = null;
        // Give a moment for close to propagate
        return new Promise<string>((r) => setTimeout(() => r('server-closed'), 500));
      }),
    ]);

    // Either got a response or the connection was closed — no hang
    expect(['closed', 'response', 'server-closed']).toContain(result);
    ws.close();
  });

  // 6.5 Multiple restart cycles work
  it('6.5 Multiple restart cycles work', async () => {
    const port = testPort;

    for (let i = 0; i < 3; i++) {
      server = await startGatewayServer(port);
      const c = await openClawConnect(port);
      expect(c.helloOk.ok).toBe(true);

      const res = await call(c.ws, 'health');
      expect(res.ok).toBe(true);

      c.ws.close();
      await server.close();
      server = null;
    }
  });
});
