import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { logger } from '../logger.js';
import { makeEvent } from '../gateway/protocol.js';
import type { GatewayClient } from '../gateway/server.js';
import type { ConnectParams } from '../gateway/protocol.js';
import type { NodeSession, NodeInvokeParams, NodeInvokeResult, PairingRequest } from './types.js';

const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

interface PendingInvoke {
  resolve: (result: NodeInvokeResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NodeRegistry {
  /** nodeId → NodeSession */
  private nodes = new Map<string, NodeSession>();
  /** connId → nodeId */
  private connToNode = new Map<string, string>();
  /** nodeId → GatewayClient */
  private nodeClients = new Map<string, GatewayClient>();
  /** invokeId → pending promise */
  private pendingInvokes = new Map<string, PendingInvoke>();
  /** requestId → PairingRequest */
  private pairingRequests = new Map<string, PairingRequest>();

  /**
   * Register a node client after successful connect handshake.
   */
  register(client: GatewayClient, params: ConnectParams): NodeSession {
    const nodeId = params.device?.id || params.client.id || client.connId;
    const session: NodeSession = {
      nodeId,
      connId: client.connId,
      displayName: params.client.displayName || params.client.id,
      platform: params.client.platform,
      version: params.client.version,
      deviceFamily: params.client.deviceFamily,
      modelIdentifier: params.client.modelIdentifier,
      caps: params.caps || [],
      commands: params.commands || [],
      permissions: params.permissions || {},
      connectedAtMs: Date.now(),
    };

    this.nodes.set(nodeId, session);
    this.connToNode.set(client.connId, nodeId);
    this.nodeClients.set(nodeId, client);

    logger.info({ nodeId, connId: client.connId, platform: session.platform }, 'Node registered');
    return session;
  }

  /**
   * Unregister a node by connection ID (called on WS close).
   * Returns the nodeId if found, null otherwise.
   */
  unregister(connId: string): string | null {
    const nodeId = this.connToNode.get(connId);
    if (!nodeId) return null;

    this.nodes.delete(nodeId);
    this.connToNode.delete(connId);
    this.nodeClients.delete(nodeId);

    // Reject any pending invokes for this node
    for (const [id, pending] of this.pendingInvokes) {
      // Check if this invoke was for the disconnected node
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'Node disconnected' });
      this.pendingInvokes.delete(id);
    }

    logger.info({ nodeId, connId }, 'Node unregistered');
    return nodeId;
  }

  listConnected(): NodeSession[] {
    return Array.from(this.nodes.values());
  }

  get(nodeId: string): NodeSession | undefined {
    return this.nodes.get(nodeId);
  }

  rename(nodeId: string, displayName: string): boolean {
    const session = this.nodes.get(nodeId);
    if (!session) return false;
    session.displayName = displayName;
    return true;
  }

  /**
   * Invoke a command on a node. Returns a promise that resolves
   * when the node sends back a result or the timeout expires.
   */
  async invoke(params: NodeInvokeParams): Promise<NodeInvokeResult> {
    const client = this.nodeClients.get(params.nodeId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return { ok: false, error: 'Node not connected' };
    }

    const invokeId = params.idempotencyKey || randomUUID();
    const timeoutMs = params.timeoutMs || DEFAULT_INVOKE_TIMEOUT_MS;

    return new Promise<NodeInvokeResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(invokeId);
        resolve({ ok: false, error: 'Invoke timed out' });
      }, timeoutMs);

      this.pendingInvokes.set(invokeId, { resolve, timer });

      // Send invoke request event to the node
      const event = makeEvent('node.invoke.request', {
        id: invokeId,
        command: params.command,
        params: params.params,
      });
      client.ws.send(JSON.stringify(event));
    });
  }

  /**
   * Handle an invoke result from a node.
   * Returns true if a matching pending invoke was found.
   */
  handleInvokeResult(params: { id: string; nodeId: string; ok: boolean; payload?: unknown; error?: string }): boolean {
    const pending = this.pendingInvokes.get(params.id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingInvokes.delete(params.id);
    pending.resolve({
      ok: params.ok,
      payload: params.payload,
      error: params.error,
    });
    return true;
  }

  /**
   * Send an event to a specific node.
   */
  sendEvent(nodeId: string, event: string, payload?: unknown): boolean {
    const client = this.nodeClients.get(nodeId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    const frame = makeEvent(event, payload);
    client.ws.send(JSON.stringify(frame));
    return true;
  }

  // --- Pairing ---

  requestPairing(deviceId: string, displayName?: string): PairingRequest {
    const requestId = randomUUID();
    const request: PairingRequest = {
      requestId,
      deviceId,
      displayName,
      requestedAtMs: Date.now(),
      status: 'pending',
    };
    this.pairingRequests.set(requestId, request);
    return request;
  }

  listPairingRequests(): { pending: PairingRequest[]; paired: NodeSession[] } {
    const pending = Array.from(this.pairingRequests.values()).filter((r) => r.status === 'pending');
    return { pending, paired: this.listConnected() };
  }

  approvePairing(requestId: string): boolean {
    const req = this.pairingRequests.get(requestId);
    if (!req || req.status !== 'pending') return false;
    req.status = 'approved';
    return true;
  }

  rejectPairing(requestId: string): boolean {
    const req = this.pairingRequests.get(requestId);
    if (!req || req.status !== 'pending') return false;
    req.status = 'rejected';
    this.pairingRequests.delete(requestId);
    return true;
  }

  verifyNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /** Number of connected nodes */
  get size(): number {
    return this.nodes.size;
  }

  /** Clear all state (for tests) */
  clear(): void {
    for (const [, pending] of this.pendingInvokes) {
      clearTimeout(pending.timer);
    }
    this.nodes.clear();
    this.connToNode.clear();
    this.nodeClients.clear();
    this.pendingInvokes.clear();
    this.pairingRequests.clear();
  }
}
