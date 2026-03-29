/**
 * Scenario 9: HTTP Endpoints
 * Verifies HTTP health/readiness/metrics endpoints match expectations.
 * 6 tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';

let server: GatewayServer | null = null;
let testPort = 31900;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario 9: HTTP Endpoints', () => {
  // 9.1 GET /health → 200
  it('9.1 GET /health returns 200 with {ok:true, status:"live"}', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/health`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.status).toBe('live');
  });

  // 9.2 GET /ready → 200
  it('9.2 GET /ready returns 200 with {ready:true}', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/ready`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ready).toBe(true);
  });

  // 9.3 GET /metrics → 200
  it('9.3 GET /metrics returns 200 with uptime and memoryUsageMb', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/metrics`);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.memoryUsageMb).toBe('number');
  });

  // 9.4 GET /unknown → 404
  it('9.4 GET /unknown returns 404', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/unknown-path`);

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  // 9.5 HEAD /health → 200
  it('9.5 HEAD /health returns 200', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/health`, { method: 'HEAD' });

    // HEAD requests should return 200 (same route as GET)
    expect(res.status).toBe(200);
  });

  // 9.6 POST /health → 405 Method Not Allowed
  it('9.6 POST /health returns 405 Method Not Allowed', async () => {
    server = await startGatewayServer(testPort);
    const res = await fetch(`http://127.0.0.1:${testPort}/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    const body = await res.json() as any;
    expect(body.error).toBe('Method Not Allowed');
  });
});
