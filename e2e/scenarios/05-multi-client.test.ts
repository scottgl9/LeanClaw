/**
 * Scenario 5: Multi-Client Connections
 * Verifies multiple simultaneous WebSocket clients work correctly.
 * 6 tests covering concurrent connections, broadcast, disconnect isolation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { makeEvent } from '../../src/gateway/protocol.js';
import { openClawConnect, call, CLIENT_FIXTURES } from '../helpers/client.js';
import WebSocket from 'ws';

let server: GatewayServer | null = null;
let testPort = 31500;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario 5: Multi-Client Connections', () => {
  // 5.1 Two clients connect simultaneously — both get hello-ok, unique connIds
  it('5.1 Two clients connect simultaneously — both get hello-ok, unique connIds', async () => {
    server = await startGatewayServer(testPort);

    const [c1, c2] = await Promise.all([
      openClawConnect(testPort, { clientName: 'client-1' }),
      openClawConnect(testPort, { clientName: 'client-2' }),
    ]);

    expect(c1.helloOk.ok).toBe(true);
    expect(c2.helloOk.ok).toBe(true);
    expect(c1.connId).toBeTruthy();
    expect(c2.connId).toBeTruthy();
    expect(c1.connId).not.toBe(c2.connId);

    c1.ws.close();
    c2.ws.close();
  });

  // 5.2 Broadcast events reach all authenticated clients
  it('5.2 Broadcast events reach all authenticated clients', async () => {
    server = await startGatewayServer(testPort);

    const c1 = await openClawConnect(testPort, { clientName: 'client-1' });
    const c2 = await openClawConnect(testPort, { clientName: 'client-2' });

    // Set up listeners for broadcast
    const received1 = new Promise<any>((resolve) => {
      c1.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.event === 'test-broadcast') resolve(msg);
      });
    });
    const received2 = new Promise<any>((resolve) => {
      c2.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event' && msg.event === 'test-broadcast') resolve(msg);
      });
    });

    // Broadcast an event
    server!.broadcast(makeEvent('test-broadcast', { hello: 'world' }));

    const [msg1, msg2] = await Promise.all([received1, received2]);
    expect(msg1.event).toBe('test-broadcast');
    expect(msg1.payload.hello).toBe('world');
    expect(msg2.event).toBe('test-broadcast');
    expect(msg2.payload.hello).toBe('world');

    c1.ws.close();
    c2.ws.close();
  });

  // 5.3 One client disconnect doesn't affect other
  it('5.3 One client disconnect doesn\'t affect other', async () => {
    server = await startGatewayServer(testPort);

    const c1 = await openClawConnect(testPort, { clientName: 'client-1' });
    const c2 = await openClawConnect(testPort, { clientName: 'client-2' });

    // Disconnect client 1
    c1.ws.close();
    await new Promise((r) => setTimeout(r, 100));

    // Client 2 should still work
    const res = await call(c2.ws, 'health');
    expect(res.ok).toBe(true);
    expect(res.payload.uptimeMs).toBeGreaterThanOrEqual(0);

    c2.ws.close();
  });

  // 5.4 Clients with different modes (backend, cli, ui) all accepted
  it('5.4 Clients with different modes all accepted', async () => {
    server = await startGatewayServer(testPort);

    const modes = ['backend', 'cli', 'ui'];
    const clients = await Promise.all(
      modes.map((mode) => openClawConnect(testPort, { clientName: `client-${mode}`, mode })),
    );

    for (const c of clients) {
      expect(c.helloOk.ok).toBe(true);
      expect(c.connId).toBeTruthy();
    }

    // All connIds unique
    const ids = clients.map((c) => c.connId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const c of clients) c.ws.close();
  });

  // 5.5 Presence in hello-ok snapshot reflects connected clients
  it('5.5 Presence in hello-ok snapshot reflects connected clients', async () => {
    server = await startGatewayServer(testPort);

    // Connect first client
    const c1 = await openClawConnect(testPort, { clientName: 'first-client' });

    // Connect second client — its presence snapshot should include c1
    const c2 = await openClawConnect(testPort, { clientName: 'second-client' });
    const presence = c2.helloOk.payload.snapshot.presence;
    expect(Array.isArray(presence)).toBe(true);
    // At minimum the second client itself should be in presence
    // The first client should also be there
    expect(presence.length).toBeGreaterThanOrEqual(2);
    const connIds = presence.map((p: any) => p.connId);
    expect(connIds).toContain(c1.connId);
    expect(connIds).toContain(c2.connId);

    c1.ws.close();
    c2.ws.close();
  });

  // 5.6 10 concurrent connections — all functional
  it('5.6 10 concurrent connections — all functional', async () => {
    server = await startGatewayServer(testPort);

    const clients = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        openClawConnect(testPort, { clientName: `client-${i}` }),
      ),
    );

    // All got hello-ok with unique connIds
    const connIds = new Set(clients.map((c) => c.connId));
    expect(connIds.size).toBe(10);

    // All can call health
    const results = await Promise.all(
      clients.map((c) => call(c.ws, 'health')),
    );
    for (const res of results) {
      expect(res.ok).toBe(true);
    }

    for (const c of clients) c.ws.close();
  });
});
