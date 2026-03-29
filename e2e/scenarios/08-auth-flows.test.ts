/**
 * Scenario 8: Authentication Flows
 * Verifies auth behavior matches OpenClaw when LEANCLAW_GATEWAY_API_KEY is set.
 * 7 tests covering open access, token required, correct/wrong token, auth fields.
 */
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, connectRaw, sendRaw } from '../helpers/client.js';
import { PROTOCOL_VERSION } from '../../src/gateway/protocol.js';

let server: GatewayServer | null = null;
let testPort = 31800;
const savedApiKey = process.env['LEANCLAW_GATEWAY_API_KEY'];

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  // Restore original env
  if (savedApiKey !== undefined) {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = savedApiKey;
  } else {
    delete process.env['LEANCLAW_GATEWAY_API_KEY'];
  }
  testPort++;
});

describe('Scenario 8: Authentication Flows', () => {
  // 8.1 No API key configured — connect without token succeeds
  it('8.1 No API key configured — open access', async () => {
    delete process.env['LEANCLAW_GATEWAY_API_KEY'];
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort);
    expect(helloOk.ok).toBe(true);
    expect(helloOk.payload.type).toBe('hello-ok');

    ws.close();
  });

  // 8.2 API key configured — connect without token returns UNAUTHORIZED + close
  it('8.2 API key configured — connect without token rejected', async () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'test-key-123';
    server = await startGatewayServer(testPort);

    const { ws, challenge } = await connectRaw(testPort);
    expect(challenge.type).toBe('event');
    expect(challenge.event).toBe('connect.challenge');

    // Send connect without auth token
    const res = await sendRaw(ws, JSON.stringify({
      type: 'req',
      id: 'auth-test-notoken',
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: { id: 'auth-client', version: '1.0', platform: 'linux', mode: 'test' },
      },
    }));

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAUTHORIZED');

    ws.close();
  });

  // 8.3 Correct token accepted — hello-ok returned
  it('8.3 Correct token accepted — hello-ok returned', async () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'test-key-123';
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort, {
      token: 'test-key-123',
    });
    expect(helloOk.ok).toBe(true);
    expect(helloOk.payload.type).toBe('hello-ok');

    ws.close();
  });

  // 8.4 Wrong token rejected — UNAUTHORIZED + close (4401)
  it('8.4 Wrong token rejected — UNAUTHORIZED + close', async () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'test-key-123';
    server = await startGatewayServer(testPort);

    const { ws, challenge } = await connectRaw(testPort);
    expect(challenge.event).toBe('connect.challenge');

    const res = await sendRaw(ws, JSON.stringify({
      type: 'req',
      id: 'auth-test-wrong',
      method: 'connect',
      params: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: { id: 'auth-client', version: '1.0', platform: 'linux', mode: 'test' },
        auth: { token: 'wrong-key-456' },
      },
    }));

    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('UNAUTHORIZED');

    ws.close();
  });

  // 8.5 hello-ok.auth.deviceToken is non-empty string
  it('8.5 hello-ok.auth.deviceToken is non-empty string', async () => {
    delete process.env['LEANCLAW_GATEWAY_API_KEY'];
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort);
    const auth = helloOk.payload.auth;
    expect(auth).toBeDefined();
    expect(typeof auth.deviceToken).toBe('string');
    expect(auth.deviceToken.length).toBeGreaterThan(0);

    ws.close();
  });

  // 8.6 Role from connect params is reflected in auth response
  it('8.6 Role from connect params reflected in auth response', async () => {
    delete process.env['LEANCLAW_GATEWAY_API_KEY'];
    server = await startGatewayServer(testPort);

    const { ws, helloOk } = await openClawConnect(testPort, {
      role: 'node',
    });

    expect(helloOk.payload.auth.role).toBe('node');

    ws.close();
  });

  // 8.7 Scopes from connect params are reflected in auth response
  it('8.7 Scopes from connect params reflected in auth response', async () => {
    delete process.env['LEANCLAW_GATEWAY_API_KEY'];
    server = await startGatewayServer(testPort);

    const scopes = ['operator.admin', 'ui.read', 'custom.scope'];
    const { ws, helloOk } = await openClawConnect(testPort, { scopes });

    expect(helloOk.payload.auth.scopes).toEqual(scopes);

    ws.close();
  });
});
