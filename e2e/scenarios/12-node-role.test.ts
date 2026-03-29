/**
 * Scenario 12: Node Role Connections
 * Verifies that OpenClaw "node" role clients can connect with caps, commands,
 * permissions, and device attestation fields — and call methods after connect.
 * 5 tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, call } from '../helpers/client.js';

let server: GatewayServer | null = null;
let testPort = 32000;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario 12: Node Role Connections', () => {
  // 12.1 Node connect with role:'node' and caps array
  it('12.1 Node connect with role:node and caps array — hello-ok accepted', async () => {
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort, {
      role: 'node',
      caps: ['tool-events', 'exec', 'streaming'],
    });

    expect(helloOk.ok).toBe(true);
    expect(helloOk.payload.type).toBe('hello-ok');
    expect(helloOk.payload.auth.role).toBe('node');

    ws.close();
  });

  // 12.2 Node connect with commands array
  it('12.2 Node connect with commands array — hello-ok accepted', async () => {
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort, {
      role: 'node',
      commands: ['status', 'restart', 'exec', 'deploy'],
    });

    expect(helloOk.ok).toBe(true);
    expect(helloOk.payload.type).toBe('hello-ok');

    ws.close();
  });

  // 12.3 Node connect with permissions object
  it('12.3 Node connect with permissions object — hello-ok accepted', async () => {
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort, {
      role: 'node',
      permissions: {
        'agent.execute': true,
        'shell.run': true,
        'file.write': false,
      },
    });

    expect(helloOk.ok).toBe(true);
    expect(helloOk.payload.type).toBe('hello-ok');

    ws.close();
  });

  // 12.4 Node connect with full device attestation
  it('12.4 Node connect with device attestation — hello-ok accepted', async () => {
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort, {
      role: 'node',
      caps: ['tool-events', 'exec'],
      device: {
        id: 'device-abc-123',
        publicKey: 'pk_test_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        signature: 'sig_test_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
        signedAt: Date.now(),
        nonce: 'nonce-xyz-789',
      },
    });

    expect(helloOk.ok).toBe(true);
    expect(helloOk.payload.type).toBe('hello-ok');
    expect(helloOk.payload.auth.role).toBe('node');

    ws.close();
  });

  // 12.5 Node can call registered methods after connect
  it('12.5 Node can call health and status after connect', async () => {
    server = await startGatewayServer(testPort);

    const { ws } = await openClawConnect(testPort, {
      role: 'node',
      caps: ['tool-events', 'exec'],
    });

    const healthRes = await call(ws, 'health');
    expect(healthRes.ok).toBe(true);
    expect(typeof healthRes.payload.uptimeMs).toBe('number');

    const statusRes = await call(ws, 'status');
    expect(statusRes.ok).toBe(true);
    expect(typeof statusRes.payload.uptimeMs).toBe('number');

    ws.close();
  });
});
