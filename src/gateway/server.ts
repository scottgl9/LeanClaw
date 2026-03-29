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

export interface GatewayClient {
  id: string;
  ws: WebSocket;
  connId: string;
  clientInfo?: ConnectParams['client'];
  authenticated: boolean;
  role: string;
}

export interface GatewayServer {
  close(): Promise<void>;
  broadcast(event: EventFrame): void;
  getClients(): Map<string, GatewayClient>;
  registerMethod(method: string, handler: MethodHandler): void;
}

export function startGatewayServer(
  port: number = GATEWAY_PORT,
  host: string = GATEWAY_HOST,
): Promise<GatewayServer> {
  const clients = new Map<string, GatewayClient>();
  const methods = new Map<string, MethodHandler>();
  const startTime = Date.now();
  let eventSeq = 0;

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
  registerMethod('sessions.send', async (params) => {
    const p = params as any;
    if (p?.chatJid && p?.text) {
      const chatSend = methods.get('chat.send');
      if (chatSend) return chatSend(params, '');
    }
    return { ok: false, error: 'sessions.send not supported — use chat.send with {chatJid, text}' };
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
  registerMethod('tools.catalog', async () => []);
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
  registerMethod('send', async (params) => {
    // Legacy send — forward to chat.send
    const handler = methods.get('chat.send');
    if (handler) return handler(params, '');
    return { error: 'chat.send not available' };
  });

  // --- HTTP server ---
  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Handle health endpoints
    if (handleHealthRequest(req, res)) return;

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

        const helloOk: HelloOkPayload = {
          type: 'hello-ok',
          protocol: PROTOCOL_VERSION,
          server: {
            version: '0.1.0',
            connId,
          },
          features: {
            methods: Array.from(methods.keys()),
            events: ['connect.challenge', 'tick', 'chat', 'agent', 'session.message', 'health', 'cron', 'presence', 'system', 'exec.approval.requested', 'shutdown'],
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

      const server: GatewayServer = {
        async close() {
          clearInterval(tickTimer);
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
      };

      resolve(server);
    });
  });
}
