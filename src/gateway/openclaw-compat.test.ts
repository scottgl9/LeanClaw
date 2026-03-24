/**
 * OpenClaw Gateway Protocol Compatibility Tests
 *
 * Verifies LeanClaw's gateway is compatible with real OpenClaw clients
 * by testing against the exact protocol v3 specification.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from './server.js';
import { PROTOCOL_VERSION } from './protocol.js';

let server: GatewayServer | null = null;
let testPort = 29100;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

/**
 * Simulates the OpenClaw gateway client connect flow exactly.
 * Based on openclaw/src/gateway/client.ts
 */
function openClawClientConnect(port: number, opts?: {
  clientName?: string;
  mode?: string;
  role?: string;
  token?: string;
}): Promise<{ ws: WebSocket; challenge: any; helloOk: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('error', reject);

    // Step 1: Receive connect.challenge
    ws.once('message', (data) => {
      const challenge = JSON.parse(data.toString());

      // Step 2: Send connect request (matching OpenClaw client format)
      const connectReq = {
        type: 'req',
        id: `req-${Date.now()}`,
        method: 'connect',
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: opts?.clientName || 'gateway-client',
            version: '2026.3.24',
            platform: process.platform,
            mode: opts?.mode || 'backend',
          },
          role: opts?.role || 'operator',
          scopes: ['operator.admin'],
          caps: ['tool-events'],
          auth: opts?.token ? { token: opts.token } : undefined,
        },
      };

      // Step 3: Receive hello-ok
      ws.once('message', (data2) => {
        const helloOk = JSON.parse(data2.toString());
        resolve({ ws, challenge, helloOk });
      });

      ws.send(JSON.stringify(connectReq));
    });
  });
}

function call(ws: WebSocket, method: string, params?: unknown): Promise<any> {
  const id = `req-${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

describe('OpenClaw Protocol v3 Compatibility', () => {
  describe('Connect handshake', () => {
    it('sends connect.challenge event on connection', async () => {
      server = await startGatewayServer(testPort);
      const { ws, challenge } = await openClawClientConnect(testPort);

      // OpenClaw expects: { type: "event", event: "connect.challenge", payload: { nonce, ts } }
      expect(challenge.type).toBe('event');
      expect(challenge.event).toBe('connect.challenge');
      expect(challenge.payload).toBeDefined();
      expect(typeof challenge.payload.nonce).toBe('string');
      expect(typeof challenge.payload.ts).toBe('number');
      ws.close();
    });

    it('returns hello-ok with all required OpenClaw fields', async () => {
      server = await startGatewayServer(testPort);
      const { ws, helloOk } = await openClawClientConnect(testPort);

      // Verify response frame structure
      expect(helloOk.type).toBe('res');
      expect(helloOk.ok).toBe(true);

      const payload = helloOk.payload;

      // Required hello-ok fields (OpenClaw schema)
      expect(payload.type).toBe('hello-ok');
      expect(payload.protocol).toBe(3);

      // server block
      expect(payload.server).toBeDefined();
      expect(typeof payload.server.version).toBe('string');
      expect(payload.server.version.length).toBeGreaterThan(0);
      expect(typeof payload.server.connId).toBe('string');
      expect(payload.server.connId.length).toBeGreaterThan(0);

      // features block
      expect(payload.features).toBeDefined();
      expect(Array.isArray(payload.features.methods)).toBe(true);
      expect(Array.isArray(payload.features.events)).toBe(true);

      // snapshot block (OpenClaw requires presence, health, stateVersion, uptimeMs)
      expect(payload.snapshot).toBeDefined();
      expect(Array.isArray(payload.snapshot.presence)).toBe(true);
      expect(typeof payload.snapshot.health).toBe('object');
      expect(payload.snapshot.stateVersion).toBeDefined();
      expect(typeof payload.snapshot.stateVersion.presence).toBe('number');
      expect(typeof payload.snapshot.stateVersion.health).toBe('number');
      expect(typeof payload.snapshot.uptimeMs).toBe('number');
      expect(payload.snapshot.uptimeMs).toBeGreaterThanOrEqual(0);

      // policy block (all must be positive integers)
      expect(payload.policy).toBeDefined();
      expect(payload.policy.maxPayload).toBeGreaterThan(0);
      expect(payload.policy.maxBufferedBytes).toBeGreaterThan(0);
      expect(payload.policy.tickIntervalMs).toBeGreaterThan(0);

      ws.close();
    });

    it('negotiates protocol version 3', async () => {
      server = await startGatewayServer(testPort);
      const { ws, helloOk } = await openClawClientConnect(testPort);
      expect(helloOk.payload.protocol).toBe(3);
      ws.close();
    });

    it('rejects protocol versions below 3', async () => {
      server = await startGatewayServer(testPort);

      // Connect and wait for challenge + response in one flow
      const result = await new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${testPort}`);
        const messages: any[] = [];
        ws.on('error', () => { /* connection may close after rejection */ });
        ws.on('message', (data) => {
          messages.push(JSON.parse(data.toString()));
          if (messages.length === 1) {
            // Got challenge, send connect with old protocol
            ws.send(JSON.stringify({
              type: 'req', id: '1', method: 'connect',
              params: {
                minProtocol: 1, maxProtocol: 2,
                client: { id: 'old-client', version: '1.0', platform: 'linux', mode: 'test' },
              },
            }));
          } else {
            // Got response
            resolve(messages[1]);
            ws.close();
          }
        });
        ws.on('close', () => {
          if (messages.length >= 2) return;
          // Server closed before we got the response — still a rejection
          resolve({ ok: false, closed: true });
        });
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('Frame format', () => {
    it('request frames have type=req, id, method', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      // The response must mirror the request id
      const reqId = 'test-req-42';
      const res = await new Promise<any>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString())));
        ws.send(JSON.stringify({ type: 'req', id: reqId, method: 'health' }));
      });

      expect(res.type).toBe('res');
      expect(res.id).toBe(reqId);
      expect(res.ok).toBe(true);
      ws.close();
    });

    it('error responses have code and message fields', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      const res = await call(ws, 'nonexistent.method');

      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
      expect(typeof res.error.code).toBe('string');
      expect(typeof res.error.message).toBe('string');
      ws.close();
    });
  });

  describe('OpenClaw client modes', () => {
    it('accepts mode=backend (standard gateway client)', async () => {
      server = await startGatewayServer(testPort);
      const { ws, helloOk } = await openClawClientConnect(testPort, { mode: 'backend' });
      expect(helloOk.ok).toBe(true);
      ws.close();
    });

    it('accepts mode=cli', async () => {
      server = await startGatewayServer(testPort);
      const { ws, helloOk } = await openClawClientConnect(testPort, { mode: 'cli' });
      expect(helloOk.ok).toBe(true);
      ws.close();
    });

    it('accepts mode=ui (control UI)', async () => {
      server = await startGatewayServer(testPort);
      const { ws, helloOk } = await openClawClientConnect(testPort, { mode: 'ui' });
      expect(helloOk.ok).toBe(true);
      ws.close();
    });

    it('accepts mode=probe (health probe)', async () => {
      server = await startGatewayServer(testPort);
      const { ws, helloOk } = await openClawClientConnect(testPort, { mode: 'probe' });
      expect(helloOk.ok).toBe(true);
      ws.close();
    });
  });

  describe('Core OpenClaw methods', () => {
    it('health method returns uptimeMs', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      const res = await call(ws, 'health');
      expect(res.ok).toBe(true);
      expect(res.payload.uptimeMs).toBeDefined();
      ws.close();
    });

    it('sessions.list returns an array', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      const res = await call(ws, 'sessions.list');
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.payload)).toBe(true);
      ws.close();
    });

    it('config.get returns an object', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      const res = await call(ws, 'config.get');
      expect(res.ok).toBe(true);
      expect(typeof res.payload).toBe('object');
      ws.close();
    });

    it('channels.status returns an array', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      const res = await call(ws, 'channels.status');
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.payload)).toBe(true);
      ws.close();
    });

    it('cron.list returns an array', async () => {
      server = await startGatewayServer(testPort);
      const { ws } = await openClawClientConnect(testPort);

      const res = await call(ws, 'cron.list');
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.payload)).toBe(true);
      ws.close();
    });
  });
});
