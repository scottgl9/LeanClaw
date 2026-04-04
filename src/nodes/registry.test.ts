import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { NodeRegistry } from './registry.js';
import type { GatewayClient } from '../gateway/server.js';
import type { ConnectParams } from '../gateway/protocol.js';

function makeClient(overrides: Partial<GatewayClient> = {}): GatewayClient {
  const sent: string[] = [];
  return {
    id: 'client-1',
    connId: 'conn-1',
    authenticated: true,
    role: 'node',
    ws: {
      readyState: WebSocket.OPEN,
      send: (data: string) => sent.push(data),
    } as unknown as WebSocket,
    ...overrides,
    _sent: sent,
  } as GatewayClient & { _sent: string[] };
}

function makeConnectParams(overrides: Partial<ConnectParams> = {}): ConnectParams {
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: 'node-device-1',
      version: '1.0.0',
      platform: 'linux',
      mode: 'node',
      displayName: 'Test Node',
      deviceFamily: 'desktop',
      modelIdentifier: 'x86_64',
    },
    caps: ['screen', 'camera'],
    commands: ['system.run'],
    permissions: { exec: true },
    device: {
      id: 'device-123',
      publicKey: 'pk-test',
      signature: 'sig-test',
      signedAt: Date.now(),
      nonce: 'nonce-test',
    },
    ...overrides,
  };
}

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  afterEach(() => {
    registry.clear();
  });

  describe('register / unregister', () => {
    it('registers a node and returns session', () => {
      const client = makeClient();
      const params = makeConnectParams();
      const session = registry.register(client, params);

      expect(session.nodeId).toBe('device-123');
      expect(session.connId).toBe('conn-1');
      expect(session.displayName).toBe('Test Node');
      expect(session.platform).toBe('linux');
      expect(session.caps).toEqual(['screen', 'camera']);
      expect(session.commands).toEqual(['system.run']);
      expect(session.permissions).toEqual({ exec: true });
      expect(session.connectedAtMs).toBeGreaterThan(0);
    });

    it('uses client.id when no device.id', () => {
      const client = makeClient();
      const params = makeConnectParams({ device: undefined });
      const session = registry.register(client, params);
      expect(session.nodeId).toBe('node-device-1');
    });

    it('unregisters by connId and returns nodeId', () => {
      const client = makeClient();
      registry.register(client, makeConnectParams());

      expect(registry.size).toBe(1);
      const nodeId = registry.unregister('conn-1');
      expect(nodeId).toBe('device-123');
      expect(registry.size).toBe(0);
    });

    it('returns null for unknown connId', () => {
      expect(registry.unregister('unknown')).toBeNull();
    });
  });

  describe('listConnected', () => {
    it('returns empty array with no nodes', () => {
      expect(registry.listConnected()).toEqual([]);
    });

    it('returns registered nodes', () => {
      registry.register(makeClient(), makeConnectParams());
      registry.register(
        makeClient({ connId: 'conn-2' }),
        makeConnectParams({ device: { id: 'device-456', publicKey: '', signature: '', signedAt: 0, nonce: '' } }),
      );

      const nodes = registry.listConnected();
      expect(nodes).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('returns node by nodeId', () => {
      registry.register(makeClient(), makeConnectParams());
      const node = registry.get('device-123');
      expect(node).toBeDefined();
      expect(node!.nodeId).toBe('device-123');
    });

    it('returns undefined for unknown nodeId', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('rename', () => {
    it('updates displayName', () => {
      registry.register(makeClient(), makeConnectParams());
      const result = registry.rename('device-123', 'New Name');
      expect(result).toBe(true);
      expect(registry.get('device-123')!.displayName).toBe('New Name');
    });

    it('returns false for unknown nodeId', () => {
      expect(registry.rename('unknown', 'name')).toBe(false);
    });
  });

  describe('invoke', () => {
    it('sends event to node and resolves on result', async () => {
      const client = makeClient();
      registry.register(client, makeConnectParams());

      const invokePromise = registry.invoke({
        nodeId: 'device-123',
        command: 'system.run',
        params: { cmd: 'ls' },
        idempotencyKey: 'invoke-1',
      });

      // Simulate node responding
      registry.handleInvokeResult({
        id: 'invoke-1',
        nodeId: 'device-123',
        ok: true,
        payload: { output: 'file.txt' },
      });

      const result = await invokePromise;
      expect(result.ok).toBe(true);
      expect(result.payload).toEqual({ output: 'file.txt' });

      // Check that event was sent to node
      const sent = (client as any)._sent;
      expect(sent).toHaveLength(1);
      const frame = JSON.parse(sent[0]);
      expect(frame.event).toBe('node.invoke.request');
      expect(frame.payload.command).toBe('system.run');
    });

    it('times out if no result received', async () => {
      const client = makeClient();
      registry.register(client, makeConnectParams());

      const result = await registry.invoke({
        nodeId: 'device-123',
        command: 'slow.command',
        timeoutMs: 50,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('returns error for unknown nodeId', async () => {
      const result = await registry.invoke({
        nodeId: 'unknown',
        command: 'test',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('returns error for disconnected node', async () => {
      const client = makeClient();
      (client.ws as any).readyState = WebSocket.CLOSED;
      registry.register(client, makeConnectParams());

      const result = await registry.invoke({
        nodeId: 'device-123',
        command: 'test',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('handleInvokeResult', () => {
    it('returns false for unknown invoke id', () => {
      expect(registry.handleInvokeResult({
        id: 'unknown', nodeId: 'any', ok: true,
      })).toBe(false);
    });
  });

  describe('unregister rejects pending invokes', () => {
    it('rejects pending invokes on disconnect', async () => {
      const client = makeClient();
      registry.register(client, makeConnectParams());

      const invokePromise = registry.invoke({
        nodeId: 'device-123',
        command: 'long.running',
        timeoutMs: 10000,
      });

      // Node disconnects
      registry.unregister('conn-1');

      const result = await invokePromise;
      expect(result.ok).toBe(false);
      expect(result.error).toContain('disconnected');
    });
  });

  describe('sendEvent', () => {
    it('sends event to connected node', () => {
      const client = makeClient();
      registry.register(client, makeConnectParams());

      const result = registry.sendEvent('device-123', 'custom.event', { data: 'test' });
      expect(result).toBe(true);

      const sent = (client as any)._sent;
      expect(sent).toHaveLength(1);
      const frame = JSON.parse(sent[0]);
      expect(frame.event).toBe('custom.event');
      expect(frame.payload).toEqual({ data: 'test' });
    });

    it('returns false for unknown nodeId', () => {
      expect(registry.sendEvent('unknown', 'test')).toBe(false);
    });
  });

  describe('pairing', () => {
    it('creates pairing request', () => {
      const req = registry.requestPairing('device-abc', 'My Phone');
      expect(req.requestId).toBeDefined();
      expect(req.deviceId).toBe('device-abc');
      expect(req.displayName).toBe('My Phone');
      expect(req.status).toBe('pending');
    });

    it('lists pending and paired', () => {
      registry.requestPairing('device-abc');
      registry.register(makeClient(), makeConnectParams());

      const list = registry.listPairingRequests();
      expect(list.pending).toHaveLength(1);
      expect(list.paired).toHaveLength(1);
    });

    it('approves pairing request', () => {
      const req = registry.requestPairing('device-abc');
      expect(registry.approvePairing(req.requestId)).toBe(true);

      // Can't approve twice
      expect(registry.approvePairing(req.requestId)).toBe(false);
    });

    it('rejects pairing request', () => {
      const req = registry.requestPairing('device-abc');
      expect(registry.rejectPairing(req.requestId)).toBe(true);

      // Request removed after rejection
      const list = registry.listPairingRequests();
      expect(list.pending).toHaveLength(0);
    });

    it('verifyNode returns true for connected node', () => {
      registry.register(makeClient(), makeConnectParams());
      expect(registry.verifyNode('device-123')).toBe(true);
      expect(registry.verifyNode('unknown')).toBe(false);
    });
  });
});
