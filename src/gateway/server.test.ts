import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from './server.js';
import { PROTOCOL_VERSION } from './protocol.js';

let server: GatewayServer | null = null;
let testPort = 19789;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++; // Use different port for each test to avoid conflicts
});

function connectAndWaitChallenge(port: number): Promise<{ ws: WebSocket; challenge: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);
    ws.once('message', (data) => {
      const challenge = JSON.parse(data.toString());
      resolve({ ws, challenge });
    });
  });
}

function sendAndReceive(ws: WebSocket, msg: unknown): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.send(JSON.stringify(msg));
  });
}

async function connectAuthenticated(port: number): Promise<WebSocket> {
  const { ws } = await connectAndWaitChallenge(port);
  await sendAndReceive(ws, {
    type: 'req', id: '1', method: 'connect',
    params: {
      minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
      client: { id: 'test', version: '1.0', platform: 'linux', mode: 'test' },
    },
  });
  return ws;
}

describe('GatewayServer', () => {
  it('starts and stops', async () => {
    server = await startGatewayServer(testPort);
    await server.close();
    server = null;
  });

  it('sends connect.challenge on connection', async () => {
    server = await startGatewayServer(testPort);
    const { ws, challenge } = await connectAndWaitChallenge(testPort);
    expect(challenge.type).toBe('event');
    expect(challenge.event).toBe('connect.challenge');
    expect(challenge.payload.nonce).toBeDefined();
    ws.close();
  });

  it('completes handshake with valid connect params', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectAndWaitChallenge(testPort);

    const res = await sendAndReceive(ws, {
      type: 'req', id: '1', method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
        client: { id: 'test', version: '1.0', platform: 'linux', mode: 'test' },
      },
    });

    expect(res.type).toBe('res');
    expect(res.ok).toBe(true);
    expect(res.payload.type).toBe('hello-ok');
    expect(res.payload.protocol).toBe(PROTOCOL_VERSION);
    expect(res.payload.features.methods).toContain('health');
    ws.close();
  });

  it('rejects protocol version mismatch', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectAndWaitChallenge(testPort);

    const res = await sendAndReceive(ws, {
      type: 'req', id: '1', method: 'connect',
      params: {
        minProtocol: 99, maxProtocol: 99,
        client: { id: 'test', version: '1.0', platform: 'linux', mode: 'test' },
      },
    });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');
    ws.close();
  });

  it('rejects method calls before authentication', async () => {
    server = await startGatewayServer(testPort);
    const { ws } = await connectAndWaitChallenge(testPort);

    const res = await sendAndReceive(ws, {
      type: 'req', id: '1', method: 'health',
    });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAUTHORIZED');
    ws.close();
  });

  it('routes method calls after authentication', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAuthenticated(testPort);

    const res = await sendAndReceive(ws, {
      type: 'req', id: '2', method: 'health',
    });

    expect(res.ok).toBe(true);
    expect(res.payload.uptimeMs).toBeDefined();
    ws.close();
  });

  it('returns error for unknown methods', async () => {
    server = await startGatewayServer(testPort);
    const ws = await connectAuthenticated(testPort);

    const res = await sendAndReceive(ws, {
      type: 'req', id: '2', method: 'nonexistent.method',
    });

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_REQUEST');
    ws.close();
  });

  it('supports custom method registration', async () => {
    server = await startGatewayServer(testPort);
    server.registerMethod('custom.echo', async (params) => ({ echo: params }));

    const ws = await connectAuthenticated(testPort);

    const res = await sendAndReceive(ws, {
      type: 'req', id: '2', method: 'custom.echo', params: { hello: 'world' },
    });

    expect(res.ok).toBe(true);
    expect(res.payload.echo).toEqual({ hello: 'world' });
    ws.close();
  });
});

describe('HTTP health endpoints', () => {
  it('GET /health returns liveness', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.status).toBe('live');
  });

  it('GET /ready returns readiness', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/ready`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ready).toBe(true);
  });

  it('GET /metrics returns metrics', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.uptime).toBeDefined();
    expect(body.memoryUsageMb).toBeDefined();
  });

  it('GET /nonexistent returns 404', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/nonexistent`);
    expect(res.status).toBe(404);
  });
});
