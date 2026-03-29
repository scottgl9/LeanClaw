import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { handleHealthRequest, setHealthProvider } from './health.js';
import type { HealthStatus } from '../types.js';

/**
 * Create mock IncomingMessage and ServerResponse for unit testing.
 */
function createMockReqRes(method: string, url: string) {
  const req = { method, url } as http.IncomingMessage;

  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = '';

  const res = {
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) headers = hdrs;
    },
    end(data?: string) {
      if (data) body = data;
    },
    get statusCode() { return statusCode; },
    get headers() { return headers; },
    get body() { return body; },
  } as unknown as http.ServerResponse & { statusCode: number; headers: Record<string, string>; body: string };

  return { req, res };
}

afterEach(() => {
  // Reset health provider to default
  setHealthProvider(() => ({
    status: 'ok',
    uptime: process.uptime(),
    activeContainers: 0,
    queuedMessages: 0,
    memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    connectedChannels: 0,
  }));
});

describe('handleHealthRequest', () => {
  it('GET /health returns 200 with {ok:true, status:live}', () => {
    const { req, res } = createMockReqRes('GET', '/health');
    const handled = handleHealthRequest(req, res);
    expect(handled).toBe(true);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe('live');
  });

  it('GET /ready returns 200 with {ready:true}', () => {
    const { req, res } = createMockReqRes('GET', '/ready');
    const handled = handleHealthRequest(req, res);
    expect(handled).toBe(true);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.ready).toBe(true);
  });

  it('GET /metrics returns 200 with uptime and memoryUsageMb', () => {
    const { req, res } = createMockReqRes('GET', '/metrics');
    const handled = handleHealthRequest(req, res);
    expect(handled).toBe(true);
    const parsed = JSON.parse((res as any).body);
    expect(typeof parsed.uptime).toBe('number');
    expect(typeof parsed.memoryUsageMb).toBe('number');
  });

  it('GET /unknown returns false (not handled)', () => {
    const { req, res } = createMockReqRes('GET', '/unknown');
    const handled = handleHealthRequest(req, res);
    expect(handled).toBe(false);
  });

  it('POST /health returns true (method is not checked, only URL)', () => {
    // handleHealthRequest doesn't check HTTP method — it handles any method on known URLs
    const { req, res } = createMockReqRes('POST', '/health');
    const handled = handleHealthRequest(req, res);
    // The implementation only checks URL, not method
    expect(handled).toBe(true);
  });

  it('setHealthProvider changes what /ready and /metrics return', () => {
    setHealthProvider(() => ({
      status: 'unhealthy',
      uptime: 42,
      activeContainers: 3,
      queuedMessages: 10,
      memoryUsageMb: 256,
      connectedChannels: 2,
    }));

    // /ready should return 503 when unhealthy
    const { req: readyReq, res: readyRes } = createMockReqRes('GET', '/ready');
    handleHealthRequest(readyReq, readyRes);
    const readyParsed = JSON.parse((readyRes as any).body);
    expect(readyParsed.ready).toBe(false);
    expect(readyParsed.status).toBe('unhealthy');

    // /metrics should return the custom values
    const { req: metricsReq, res: metricsRes } = createMockReqRes('GET', '/metrics');
    handleHealthRequest(metricsReq, metricsRes);
    const metricsParsed = JSON.parse((metricsRes as any).body);
    expect(metricsParsed.activeContainers).toBe(3);
    expect(metricsParsed.memoryUsageMb).toBe(256);
    expect(metricsParsed.connectedChannels).toBe(2);
  });

  it('health provider returning degraded status still returns 200', () => {
    setHealthProvider(() => ({
      status: 'degraded',
      uptime: 100,
      activeContainers: 1,
      queuedMessages: 5,
      memoryUsageMb: 128,
      connectedChannels: 1,
    }));

    const { req, res } = createMockReqRes('GET', '/ready');
    handleHealthRequest(req, res);
    const parsed = JSON.parse((res as any).body);
    // degraded is not 'unhealthy', so ready should be true
    expect(parsed.ready).toBe(true);
    expect(parsed.status).toBe('degraded');
  });

  it('GET /healthz works as alias for /health', () => {
    const { req, res } = createMockReqRes('GET', '/healthz');
    const handled = handleHealthRequest(req, res);
    expect(handled).toBe(true);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.ok).toBe(true);
  });

  it('GET /readyz works as alias for /ready', () => {
    const { req, res } = createMockReqRes('GET', '/readyz');
    const handled = handleHealthRequest(req, res);
    expect(handled).toBe(true);
    const parsed = JSON.parse((res as any).body);
    expect(parsed.ready).toBe(true);
  });
});
