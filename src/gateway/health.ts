import type { IncomingMessage, ServerResponse } from 'http';

import type { HealthStatus } from '../types.js';

export type HealthProvider = () => HealthStatus;

let healthProvider: HealthProvider = () => ({
  status: 'ok',
  uptime: process.uptime(),
  activeContainers: 0,
  queuedMessages: 0,
  memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  connectedChannels: 0,
});

export function setHealthProvider(provider: HealthProvider): void {
  healthProvider = provider;
}

export function handleHealthRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // Health paths only accept GET and HEAD
  const healthPaths = ['/health', '/healthz', '/ready', '/readyz', '/metrics'];
  if (healthPaths.includes(url) && method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return true;
  }

  if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, status: 'live' }));
    return true;
  }

  if (url === '/ready' || url === '/readyz') {
    const health = healthProvider();
    const ready = health.status !== 'unhealthy';
    const statusCode = ready ? 200 : 503;
    res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ready, status: health.status, uptimeMs: Math.round(health.uptime * 1000) }));
    return true;
  }

  if (url === '/metrics') {
    const health = healthProvider();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(health));
    return true;
  }

  return false;
}
