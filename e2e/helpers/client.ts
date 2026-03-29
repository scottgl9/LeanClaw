/**
 * Reusable OpenClaw-compatible WebSocket client helper for E2E tests.
 * Implements the full Protocol v3 connect handshake.
 */
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../../src/gateway/protocol.js';

export interface ConnectResult {
  ws: WebSocket;
  challenge: any;
  helloOk: any;
  connId: string;
}

export interface ConnectOpts {
  clientName?: string;
  mode?: string;
  role?: string;
  token?: string;
  minProtocol?: number;
  maxProtocol?: number;
  scopes?: string[];
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
}

// --- Fixtures for different client types ---

export const CLIENT_FIXTURES = {
  operator: {
    clientName: 'openclaw-operator',
    mode: 'backend',
    role: 'operator',
    scopes: ['operator.admin'],
    caps: ['tool-events', 'streaming'],
  },
  cli: {
    clientName: 'openclaw-cli',
    mode: 'cli',
    role: 'operator',
    scopes: ['operator.admin'],
    caps: ['tool-events'],
  },
  ui: {
    clientName: 'openclaw-ui',
    mode: 'ui',
    role: 'operator',
    scopes: ['operator.admin', 'ui.read'],
    caps: ['tool-events', 'streaming', 'canvas'],
  },
  backend: {
    clientName: 'openclaw-daemon',
    mode: 'backend',
    role: 'operator',
    scopes: ['operator.admin'],
    caps: ['tool-events'],
  },
  node: {
    clientName: 'openclaw-node',
    mode: 'node',
    role: 'node',
    scopes: ['node.exec'],
    caps: ['tool-events', 'exec'],
    commands: ['status', 'restart', 'exec'],
    permissions: { 'agent.execute': true, 'shell.run': true },
  },
} as const;

/**
 * Connects to a LeanClaw gateway as an OpenClaw client.
 * Performs full Protocol v3 handshake: challenge → connect → hello-ok.
 */
export function openClawConnect(port: number, opts: ConnectOpts = {}): Promise<ConnectResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('openClawConnect timed out after 5s'));
    }, 5000);

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Step 1: Receive connect.challenge
    ws.once('message', (data) => {
      const challenge = JSON.parse(data.toString());

      // Step 2: Send connect request
      const connectReq = {
        type: 'req',
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        method: 'connect',
        params: {
          minProtocol: opts.minProtocol ?? PROTOCOL_VERSION,
          maxProtocol: opts.maxProtocol ?? PROTOCOL_VERSION,
          client: {
            id: opts.clientName || 'e2e-client',
            version: '2026.3.28',
            platform: process.platform,
            mode: opts.mode || 'backend',
          },
          role: opts.role || 'operator',
          scopes: opts.scopes || ['operator.admin'],
          caps: opts.caps || ['tool-events'],
          commands: opts.commands,
          permissions: opts.permissions,
          device: opts.device,
          auth: opts.token ? { token: opts.token } : undefined,
        },
      };

      // Step 3: Receive hello-ok
      ws.once('message', (data2) => {
        clearTimeout(timeout);
        const helloOk = JSON.parse(data2.toString());
        const connId = helloOk.payload?.server?.connId || '';
        resolve({ ws, challenge, helloOk, connId });
      });

      ws.send(JSON.stringify(connectReq));
    });
  });
}

/**
 * Send a method call and wait for the response.
 */
export function call(ws: WebSocket, method: string, params?: unknown): Promise<any> {
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`call('${method}') timed out`)), 5000);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      // Only resolve on response frames matching our id
      if (msg.type === 'res' && msg.id === id) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

/**
 * Connect to WS and only receive the challenge (don't complete handshake).
 */
export function connectRaw(port: number): Promise<{ ws: WebSocket; challenge: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('connectRaw timed out'));
    }, 5000);
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve({ ws, challenge: JSON.parse(data.toString()) });
    });
  });
}

/**
 * Send raw data on a WebSocket and receive one message back.
 */
export function sendRaw(ws: WebSocket, data: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('sendRaw timed out')), 5000);
    ws.once('message', (msg) => {
      clearTimeout(timeout);
      resolve(JSON.parse(msg.toString()));
    });
    ws.send(data);
  });
}
