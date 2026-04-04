/**
 * OpenClaw-compatible WebSocket + HTTP gateway server.
 * Implements Protocol Version 3.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

import { GATEWAY_HOST, GATEWAY_PORT } from '../config.js';
import { logger } from '../logger.js';
import { checkRateLimit, extractBearerToken, validateApiKey } from './auth.js';
import { handleHealthRequest } from './health.js';
import {
  ConnectParamsSchema,
  ErrorCodes,
  HANDSHAKE_TIMEOUT_MS,
  MAX_PAYLOAD_BYTES,
  MAX_BUFFERED_BYTES,
  PROTOCOL_VERSION,
  TICK_INTERVAL_MS,
  RequestFrameSchema,
  makeEvent,
  makeResponse,
  type ConnectParams,
  type EventFrame,
  type HelloOkPayload,
  type MethodHandler,
  type RequestFrame,
} from './protocol.js';
import { NodeRegistry } from '../nodes/registry.js';
import { PendingWorkQueue } from '../nodes/pending.js';

export interface GatewayClient {
  id: string;
  ws: WebSocket;
  connId: string;
  clientInfo?: ConnectParams['client'];
  authenticated: boolean;
  role: string;
}

export interface PluginHttpRouteEntry {
  method: string;
  path: string;
  handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void | Promise<void>;
  pluginId: string;
}

export interface GatewayServer {
  close(): Promise<void>;
  broadcast(event: EventFrame): void;
  getClients(): Map<string, GatewayClient>;
  registerMethod(method: string, handler: MethodHandler): void;
  setPluginTools(tools: Array<{ name: string; description: string; pluginId: string }>): void;
  setPluginHttpRoutes(routes: PluginHttpRouteEntry[]): void;
  getPluginToolsCatalog(): Array<{ name: string; description: string; pluginId: string }>;
  getNodeRegistry(): NodeRegistry;
  getPendingWorkQueue(): PendingWorkQueue;
}

export function startGatewayServer(
  port: number = GATEWAY_PORT,
  host: string = GATEWAY_HOST,
): Promise<GatewayServer> {
  const clients = new Map<string, GatewayClient>();
  const methods = new Map<string, MethodHandler>();
  const startTime = Date.now();
  let eventSeq = 0;
  let pluginToolsCatalog: Array<{ name: string; description: string; pluginId: string }> = [];
  const nodeRegistry = new NodeRegistry();
  const pendingWorkQueue = new PendingWorkQueue();

  // --- Register core methods ---
  const registerMethod = (method: string, handler: MethodHandler) => {
    methods.set(method, handler);
  };

  // Built-in methods
  registerMethod('health', async () => ({
    ok: true,
    uptimeMs: Date.now() - startTime,
  }));

  // Default stubs — runtime.ts overrides these with real data
  registerMethod('sessions.list', async () => []);
  registerMethod('config.get', async () => ({}));
  registerMethod('channels.status', async () => []);
  registerMethod('cron.list', async () => []);

  // OpenClaw-compatible method stubs (return sensible defaults)
  registerMethod('status', async () => ({ ok: true, uptimeMs: Date.now() - startTime }));
  registerMethod('config.set', async () => ({ applied: false, reason: 'Config changes via gateway not supported — use LEANCLAW_* env vars' }));
  registerMethod('config.patch', async () => ({ applied: false, reason: 'Config changes via gateway not supported — use LEANCLAW_* env vars' }));
  registerMethod('config.schema', async () => ({ type: 'object', properties: {} }));
  registerMethod('sessions.send', async (params, clientId) => {
    const p = params as any;
    const chatSend = methods.get('chat.send');
    if (!chatSend) return { ok: false, error: 'chat.send not available' };

    let chatJid = p?.chatJid;

    // If no chatJid but sessionKey provided, try to resolve via sessions.list
    if (!chatJid && p?.sessionKey) {
      const sessionsList = methods.get('sessions.list');
      if (sessionsList) {
        const sessions = await sessionsList({}, clientId || '');
        const match = (sessions as any[])?.find(
          (s: any) => s.sessionId === p.sessionKey || s.folder === p.sessionKey,
        );
        if (match?.chatJid) chatJid = match.chatJid;
      }
    }

    return chatSend({ ...p, chatJid }, clientId || '');
  });
  registerMethod('sessions.patch', async () => ({ ok: true }));
  registerMethod('sessions.create', async () => ({ error: 'Sessions are created automatically on first message' }));
  registerMethod('sessions.delete', async () => ({ ok: true }));
  registerMethod('sessions.reset', async () => ({ ok: true }));
  registerMethod('sessions.compact', async () => ({ ok: true }));
  registerMethod('sessions.resolve', async () => null);
  registerMethod('cron.status', async () => ({ running: true }));
  registerMethod('channels.logout', async () => ({ ok: true }));
  registerMethod('models.list', async () => [
    { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5', provider: 'anthropic', name: 'Claude Haiku 4.5' },
  ]);
  registerMethod('tools.catalog', async () => pluginToolsCatalog);
  registerMethod('agents.list', async () => []);
  registerMethod('logs.tail', async () => []);
  registerMethod('wake', async () => ({ ok: true }));

  // --- P0 gap fixes: methods OpenClaw clients expect ---

  registerMethod('system-presence', async (_params, _clientId) => {
    return Array.from(clients.values())
      .filter((c) => c.authenticated)
      .map((c) => ({
        connId: c.connId,
        clientId: c.clientInfo?.id,
        mode: c.clientInfo?.mode,
        version: c.clientInfo?.version,
        platform: c.clientInfo?.platform,
        ts: Date.now(),
      }));
  });

  registerMethod('system-event', async () => ({ ok: true, received: true }));

  registerMethod('agent', async () => ({
    ok: true,
    runId: null,
    status: 'not_supported',
    message: 'Agent execution via gateway is a LeanClaw roadmap item. Use chat.send for now.',
  }));

  registerMethod('tools.effective', async (params) => ({
    tools: [],
    sessionKey: (params as any)?.sessionKey || null,
  }));

  registerMethod('exec.approval.resolve', async () => ({
    ok: true,
    resolved: false,
    reason: 'Exec approvals not yet supported in LeanClaw',
  }));
  registerMethod('gateway.identity.get', async () => ({
    name: 'LeanClaw',
    version: '0.1.0',
    runtime: 'leanclaw',
  }));
  registerMethod('device.token.rotate', async () => ({
    ok: true,
    deviceToken: randomUUID(),
    rotatedAt: Date.now(),
  }));

  registerMethod('device.token.revoke', async () => ({
    ok: true,
    revoked: true,
  }));

  registerMethod('skills.bins', async () => ({
    bins: [],
    version: '0.0.0',
  }));

  // --- Node methods (OpenClaw-compatible) ---
  registerMethod('node.list', async () => {
    return nodeRegistry.listConnected().map((n) => ({
      nodeId: n.nodeId,
      displayName: n.displayName,
      platform: n.platform,
      version: n.version,
      deviceFamily: n.deviceFamily,
      caps: n.caps,
      commands: n.commands,
      connectedAtMs: n.connectedAtMs,
    }));
  });

  registerMethod('node.describe', async (params) => {
    const { nodeId } = (params || {}) as { nodeId?: string };
    if (!nodeId) return { error: 'nodeId is required' };
    const node = nodeRegistry.get(nodeId);
    if (!node) return { error: `Node not found: ${nodeId}` };
    return node;
  });

  registerMethod('node.rename', async (params) => {
    const { nodeId, displayName } = (params || {}) as { nodeId?: string; displayName?: string };
    if (!nodeId || !displayName) return { error: 'nodeId and displayName are required' };
    const ok = nodeRegistry.rename(nodeId, displayName);
    return { ok, nodeId };
  });

  registerMethod('node.invoke', async (params) => {
    const p = (params || {}) as { nodeId?: string; command?: string; params?: unknown; timeoutMs?: number; idempotencyKey?: string };
    if (!p.nodeId || !p.command) return { ok: false, error: 'nodeId and command are required' };
    const result = await nodeRegistry.invoke({
      nodeId: p.nodeId,
      command: p.command,
      params: p.params,
      timeoutMs: p.timeoutMs,
      idempotencyKey: p.idempotencyKey,
    });
    return result;
  });

  registerMethod('node.invoke.result', async (params) => {
    const p = (params || {}) as { id?: string; nodeId?: string; ok?: boolean; payload?: unknown; error?: string };
    if (!p.id || !p.nodeId) return { ok: false, error: 'id and nodeId are required' };
    const found = nodeRegistry.handleInvokeResult({
      id: p.id,
      nodeId: p.nodeId,
      ok: p.ok ?? true,
      payload: p.payload,
      error: p.error,
    });
    return { ok: true, matched: found };
  });

  registerMethod('node.event', async (params) => {
    const { nodeId, event, payload } = (params || {}) as { nodeId?: string; event?: string; payload?: unknown };
    if (!nodeId || !event) return { ok: false, error: 'nodeId and event are required' };
    const sent = nodeRegistry.sendEvent(nodeId, event, payload);
    return { ok: sent };
  });

  // --- Node pairing (OpenClaw-compatible) ---
  registerMethod('node.pair.request', async (params) => {
    const { deviceId, displayName } = (params || {}) as { deviceId?: string; displayName?: string };
    if (!deviceId) return { ok: false, error: 'deviceId is required' };
    const req = nodeRegistry.requestPairing(deviceId, displayName);
    return { ok: true, requestId: req.requestId, deviceId, status: 'pending' };
  });

  registerMethod('node.pair.list', async () => {
    const { pending, paired } = nodeRegistry.listPairingRequests();
    return {
      pending: pending.map((r) => ({ requestId: r.requestId, deviceId: r.deviceId, displayName: r.displayName, requestedAtMs: r.requestedAtMs })),
      paired: paired.map((n) => ({ nodeId: n.nodeId, displayName: n.displayName, platform: n.platform, connectedAtMs: n.connectedAtMs })),
    };
  });

  registerMethod('node.pair.approve', async (params) => {
    const { requestId } = (params || {}) as { requestId?: string };
    if (!requestId) return { ok: false, error: 'requestId is required' };
    const approved = nodeRegistry.approvePairing(requestId);
    return { ok: approved, requestId, approved };
  });

  registerMethod('node.pair.reject', async (params) => {
    const { requestId } = (params || {}) as { requestId?: string };
    if (!requestId) return { ok: false, error: 'requestId is required' };
    const rejected = nodeRegistry.rejectPairing(requestId);
    return { ok: rejected, requestId, rejected };
  });

  registerMethod('node.pair.verify', async (params) => {
    const { deviceId } = (params || {}) as { deviceId?: string };
    if (!deviceId) return { ok: false, error: 'deviceId is required' };
    const verified = nodeRegistry.verifyNode(deviceId);
    return { ok: true, deviceId, verified };
  });

  // --- Node pending work queue (OpenClaw-compatible) ---
  registerMethod('node.pending.enqueue', async (params) => {
    const p = (params || {}) as { nodeId?: string; type?: string; priority?: 'normal' | 'high'; expiresMs?: number; payload?: unknown; idempotencyKey?: string };
    if (!p.nodeId || !p.type) return { ok: false, error: 'nodeId and type are required' };
    const { item, deduped } = pendingWorkQueue.enqueue({
      nodeId: p.nodeId,
      type: p.type,
      priority: p.priority,
      expiresMs: p.expiresMs,
      payload: p.payload,
      idempotencyKey: p.idempotencyKey,
    });
    return { ok: true, itemId: item.id, deduped };
  });

  registerMethod('node.pending.drain', async (params) => {
    const { nodeId } = (params || {}) as { nodeId?: string };
    if (!nodeId) return { ok: false, error: 'nodeId is required' };
    const items = pendingWorkQueue.drain(nodeId);
    return { ok: true, items };
  });

  registerMethod('node.pending.pull', async (params) => {
    const { nodeId, itemId } = (params || {}) as { nodeId?: string; itemId?: string };
    if (!nodeId || !itemId) return { ok: false, error: 'nodeId and itemId are required' };
    const item = pendingWorkQueue.pull(nodeId, itemId);
    return { ok: !!item, item };
  });

  registerMethod('node.pending.ack', async (params) => {
    const { nodeId, itemId } = (params || {}) as { nodeId?: string; itemId?: string };
    if (!nodeId || !itemId) return { ok: false, error: 'nodeId and itemId are required' };
    const acked = pendingWorkQueue.ack(nodeId, itemId);
    return { ok: acked };
  });

  // --- Talk config (OpenClaw UI compat) ---
  registerMethod('talk.config', async () => ({ channels: [], defaults: {} }));

  // --- Wizard/update stubs ---
  registerMethod('wizard.start', async () => ({ ok: true, status: 'not_supported' }));
  registerMethod('update.run', async () => ({ ok: true, status: 'not_supported' }));
  registerMethod('config.apply', async () => ({ ok: true }));

  registerMethod('send', async (params) => {
    // Legacy send — forward to chat.send
    const handler = methods.get('chat.send');
    if (handler) return handler(params, '');
    return { error: 'chat.send not available' };
  });

  // --- Plugin HTTP routes ---
  let pluginRoutes: PluginHttpRouteEntry[] = [];

  // --- HTTP server ---
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Handle health endpoints
    if (handleHealthRequest(req, res)) return;

    // Handle POST /tools/invoke
    if (req.method === 'POST' && req.url === '/tools/invoke') {
      const authToken = extractBearerToken(req.headers?.authorization);
      if (!validateApiKey(authToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const { toolName, params } = JSON.parse(body);
          if (!toolName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'toolName is required' }));
            return;
          }
          const tool = pluginToolsCatalog.find((t) => t.name === toolName);
          if (!tool) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Tool not found: ${toolName}` }));
            return;
          }
          // Find the actual executable tool from the method handler
          const catalogHandler = methods.get('tools.invoke');
          if (catalogHandler) {
            const result = await catalogHandler({ toolName, params }, '');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } else {
            res.writeHead(501, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'tools.invoke method not registered' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
        }
      });
      return;
    }

    // Handle plugin HTTP routes
    for (const route of pluginRoutes) {
      if (req.method === route.method && req.url === route.path) {
        // Require auth for plugin routes
        const authToken = extractBearerToken(req.headers?.authorization);
        if (!validateApiKey(authToken)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        try {
          await route.handler(req, res);
        } catch (err) {
          logger.error({ path: route.path, pluginId: route.pluginId, err }, 'Plugin HTTP route error');
          if (!res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Plugin route error' }));
          }
        }
        return;
      }
    }

    // Everything else is 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // --- WebSocket server ---
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress || 'unknown';

    if (!checkRateLimit(ip)) {
      ws.close(4429, 'Rate limited');
      return;
    }

    const connId = randomUUID();
    const client: GatewayClient = {
      id: connId,
      ws,
      connId,
      authenticated: false,
      role: 'operator',
    };
    clients.set(connId, client);

    logger.debug({ connId, ip }, 'WebSocket connected');

    // Send connect challenge
    const challengeNonce = randomUUID();
    ws.send(JSON.stringify(makeEvent('connect.challenge', {
      nonce: challengeNonce,
      ts: Date.now(),
    })));

    // Handshake timeout
    const handshakeTimer = setTimeout(() => {
      if (!client.authenticated) {
        logger.warn({ connId }, 'Handshake timeout');
        ws.close(4408, 'Handshake timeout');
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.on('message', async (data) => {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify(makeResponse('0', false, {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Invalid JSON',
        })));
        return;
      }

      const parsed = RequestFrameSchema.safeParse(frame);
      if (!parsed.success) {
        ws.send(JSON.stringify(makeResponse('0', false, {
          code: ErrorCodes.INVALID_REQUEST,
          message: 'Invalid request frame',
        })));
        return;
      }

      const req = parsed.data as RequestFrame;

      // Handle connect handshake
      if (req.method === 'connect') {
        clearTimeout(handshakeTimer);

        const connectParsed = ConnectParamsSchema.safeParse(req.params);
        if (!connectParsed.success) {
          ws.send(JSON.stringify(makeResponse(req.id, false, {
            code: ErrorCodes.INVALID_REQUEST,
            message: 'Invalid connect params',
          })));
          ws.close(4400, 'Invalid connect params');
          return;
        }

        const params = connectParsed.data;

        // Protocol version check
        if (params.maxProtocol < PROTOCOL_VERSION || params.minProtocol > PROTOCOL_VERSION) {
          ws.send(JSON.stringify(makeResponse(req.id, false, {
            code: ErrorCodes.INVALID_REQUEST,
            message: `Protocol version ${PROTOCOL_VERSION} required, client supports ${params.minProtocol}-${params.maxProtocol}`,
          })));
          ws.close(4400, 'Protocol mismatch');
          return;
        }

        // Auth check
        const token = params.auth?.token;
        if (!validateApiKey(token)) {
          ws.send(JSON.stringify(makeResponse(req.id, false, {
            code: ErrorCodes.UNAUTHORIZED,
            message: 'Invalid authentication',
          })));
          ws.close(4401, 'Unauthorized');
          return;
        }

        client.authenticated = true;
        client.clientInfo = params.client;
        client.role = params.role || 'operator';

        // Register node-role clients in the node registry
        if (client.role === 'node') {
          const nodeSession = nodeRegistry.register(client, params);
          // Broadcast node.connected event to all other clients
          const nodeEvent = makeEvent('node.connected', {
            nodeId: nodeSession.nodeId,
            displayName: nodeSession.displayName,
            platform: nodeSession.platform,
          });
          const eventMsg = JSON.stringify(nodeEvent);
          for (const c of clients.values()) {
            if (c.connId !== connId && c.authenticated && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(eventMsg);
            }
          }
        }

        const helloOk: HelloOkPayload = {
          type: 'hello-ok',
          protocol: PROTOCOL_VERSION,
          server: {
            version: '0.1.0',
            connId,
          },
          features: {
            methods: Array.from(methods.keys()),
            events: ['connect.challenge', 'tick', 'chat', 'agent', 'session.message', 'health', 'cron', 'presence', 'system', 'exec.approval.requested', 'shutdown', 'node.connected', 'node.disconnected', 'node.invoke.request', 'node.invoke.result'],
          },
          snapshot: {
            presence: Array.from(clients.values())
              .filter((c) => c.authenticated)
              .map((c) => ({ connId: c.connId, clientId: c.clientInfo?.id, mode: c.clientInfo?.mode })),
            health: {},
            stateVersion: { presence: clients.size, health: 1 },
            uptimeMs: Date.now() - startTime,
            authMode: process.env['LEANCLAW_GATEWAY_API_KEY'] ? 'api-key' : 'none',
          },
          policy: {
            maxPayload: MAX_PAYLOAD_BYTES,
            maxBufferedBytes: MAX_BUFFERED_BYTES,
            tickIntervalMs: TICK_INTERVAL_MS,
          },
          auth: {
            deviceToken: connId,
            role: client.role,
            scopes: (params.scopes as string[]) || ['operator.admin'],
          },
        };

        ws.send(JSON.stringify(makeResponse(req.id, true, helloOk)));
        logger.info({ connId, clientId: params.client.id, mode: params.client.mode }, 'Client connected');
        return;
      }

      // All other methods require authentication
      if (!client.authenticated) {
        ws.send(JSON.stringify(makeResponse(req.id, false, {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Not authenticated. Send connect request first.',
        })));
        return;
      }

      // Route to method handler
      const handler = methods.get(req.method);
      if (!handler) {
        ws.send(JSON.stringify(makeResponse(req.id, false, {
          code: ErrorCodes.INVALID_REQUEST,
          message: `Unknown method: ${req.method}`,
        })));
        return;
      }

      try {
        const result = await handler(req.params, client.id);
        ws.send(JSON.stringify(makeResponse(req.id, true, result)));
      } catch (err) {
        logger.error({ method: req.method, err }, 'Method handler error');
        ws.send(JSON.stringify(makeResponse(req.id, false, {
          code: ErrorCodes.UNAVAILABLE,
          message: err instanceof Error ? err.message : 'Internal error',
        })));
      }
    });

    ws.on('close', () => {
      clearTimeout(handshakeTimer);

      // Unregister node if this was a node connection
      const disconnectedNodeId = nodeRegistry.unregister(connId);
      if (disconnectedNodeId) {
        // Broadcast node.disconnected event
        const nodeEvent = makeEvent('node.disconnected', {
          nodeId: disconnectedNodeId,
        });
        const eventMsg = JSON.stringify(nodeEvent);
        for (const c of clients.values()) {
          if (c.authenticated && c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(eventMsg);
          }
        }
      }

      clients.delete(connId);
      logger.debug({ connId }, 'WebSocket disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ connId, err }, 'WebSocket error');
    });
  });

  // --- Tick heartbeat ---
  const tickTimer = setInterval(() => {
    const event = makeEvent('tick', { ts: Date.now() }, ++eventSeq);
    const msg = JSON.stringify(event);
    for (const client of clients.values()) {
      if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }, TICK_INTERVAL_MS);

  // --- Start ---
  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    httpServer.listen(port, host, () => {
      logger.info({ port, host }, 'Gateway server started');

      const setPluginTools = (tools: Array<{ name: string; description: string; pluginId: string }>) => {
        pluginToolsCatalog = tools;
      };

      const setPluginHttpRoutes = (routes: PluginHttpRouteEntry[]) => {
        pluginRoutes = routes;
      };

      const getPluginToolsCatalog = () => pluginToolsCatalog;

      const server: GatewayServer = {
        async close() {
          clearInterval(tickTimer);
          nodeRegistry.clear();
          pendingWorkQueue.clear();
          for (const client of clients.values()) {
            client.ws.close(1001, 'Server shutting down');
          }
          clients.clear();
          wss.close();
          await new Promise<void>((res) => httpServer.close(() => res()));
          logger.info('Gateway server stopped');
        },
        broadcast(event: EventFrame) {
          event.seq = ++eventSeq;
          const msg = JSON.stringify(event);
          for (const client of clients.values()) {
            if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(msg);
            }
          }
        },
        getClients() {
          return clients;
        },
        registerMethod,
        setPluginTools,
        setPluginHttpRoutes,
        getPluginToolsCatalog,
        getNodeRegistry() {
          return nodeRegistry;
        },
        getPendingWorkQueue() {
          return pendingWorkQueue;
        },
      };

      resolve(server);
    });
  });
}
