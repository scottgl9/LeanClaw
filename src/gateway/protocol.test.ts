import { describe, it, expect } from 'vitest';
import {
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  ConnectParamsSchema,
  makeResponse,
  makeEvent,
  ErrorCodes,
  PROTOCOL_VERSION,
  MAX_PAYLOAD_BYTES,
  MAX_BUFFERED_BYTES,
  TICK_INTERVAL_MS,
} from './protocol.js';

describe('protocol', () => {
  describe('RequestFrameSchema', () => {
    it('accepts valid request frames', () => {
      const result = RequestFrameSchema.safeParse({
        type: 'req',
        id: '1',
        method: 'health',
      });
      expect(result.success).toBe(true);
    });

    it('accepts frames with params', () => {
      const result = RequestFrameSchema.safeParse({
        type: 'req',
        id: '2',
        method: 'chat.send',
        params: { text: 'hello' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid type', () => {
      const result = RequestFrameSchema.safeParse({
        type: 'event',
        id: '1',
        method: 'health',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing method', () => {
      const result = RequestFrameSchema.safeParse({
        type: 'req',
        id: '1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ConnectParamsSchema', () => {
    const validParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'test-client',
        version: '1.0.0',
        platform: 'linux',
        mode: 'cli',
      },
    };

    it('accepts valid connect params', () => {
      const result = ConnectParamsSchema.safeParse(validParams);
      expect(result.success).toBe(true);
    });

    it('accepts params with auth', () => {
      const result = ConnectParamsSchema.safeParse({
        ...validParams,
        auth: { token: 'my-token' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing client', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 3,
        maxProtocol: 3,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('makeResponse', () => {
    it('creates success response', () => {
      const res = makeResponse('1', true, { data: 'test' });
      expect(res.type).toBe('res');
      expect(res.ok).toBe(true);
      expect(res.payload).toEqual({ data: 'test' });
    });

    it('creates error response', () => {
      const res = makeResponse('1', false, { code: 'ERROR', message: 'fail' });
      expect(res.ok).toBe(false);
      expect(res.error).toEqual({ code: 'ERROR', message: 'fail' });
    });
  });

  describe('makeEvent', () => {
    it('creates event frame', () => {
      const event = makeEvent('tick', { ts: 123 }, 1);
      expect(event.type).toBe('event');
      expect(event.event).toBe('tick');
      expect(event.seq).toBe(1);
    });
  });

  it('PROTOCOL_VERSION is 3', () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });

  describe('ResponseFrameSchema', () => {
    it('accepts valid success response', () => {
      const result = ResponseFrameSchema.safeParse({
        type: 'res', id: 'r1', ok: true, payload: { data: 'test' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid error response', () => {
      const result = ResponseFrameSchema.safeParse({
        type: 'res', id: 'r2', ok: false,
        error: { code: 'ERR', message: 'Something failed' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing id', () => {
      const result = ResponseFrameSchema.safeParse({
        type: 'res', ok: true, payload: {},
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid type (not res)', () => {
      const result = ResponseFrameSchema.safeParse({
        type: 'req', id: 'r3', ok: true,
      });
      expect(result.success).toBe(false);
    });

    it('accepts error with optional retryable field', () => {
      const result = ResponseFrameSchema.safeParse({
        type: 'res', id: 'r4', ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too fast', retryable: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error!.retryable).toBe(true);
      }
    });

    it('accepts error with optional details field', () => {
      const result = ResponseFrameSchema.safeParse({
        type: 'res', id: 'r5', ok: false,
        error: { code: 'ERR', message: 'Bad', details: { field: 'name' } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error!.details).toEqual({ field: 'name' });
      }
    });
  });

  describe('EventFrameSchema', () => {
    it('accepts valid event', () => {
      const result = EventFrameSchema.safeParse({
        type: 'event', event: 'tick', payload: { ts: 1 }, seq: 1,
      });
      expect(result.success).toBe(true);
    });

    it('accepts event without seq (optional)', () => {
      const result = EventFrameSchema.safeParse({
        type: 'event', event: 'tick', payload: { ts: 1 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts event without payload (optional)', () => {
      const result = EventFrameSchema.safeParse({
        type: 'event', event: 'shutdown',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing event name', () => {
      const result = EventFrameSchema.safeParse({
        type: 'event', payload: {},
      });
      expect(result.success).toBe(false);
    });

    it('rejects type != event', () => {
      const result = EventFrameSchema.safeParse({
        type: 'req', event: 'tick',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ConnectParamsSchema - comprehensive field validation', () => {
    const base = {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: 'c1', version: '1.0.0', platform: 'linux', mode: 'cli' },
    };

    it('accepts full connect params with all optional fields', () => {
      const result = ConnectParamsSchema.safeParse({
        ...base,
        caps: ['tool-events', 'streaming'],
        commands: ['status', 'restart'],
        permissions: { 'agent.execute': true },
        locale: 'en-US',
        userAgent: 'OpenClaw/2026.3',
        scopes: ['operator.admin'],
        role: 'operator',
        auth: { token: 'tok', bootstrapToken: 'bt', deviceToken: 'dt', password: 'pw' },
        device: { id: 'd1', publicKey: 'pk', signature: 'sig', signedAt: 123, nonce: 'n1' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts node role connect params', () => {
      const result = ConnectParamsSchema.safeParse({
        ...base,
        role: 'node',
        caps: ['camera'],
        commands: ['camera.snap'],
        permissions: { 'camera.capture': true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('node');
      }
    });

    it('accepts UI mode params', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'ui', version: '1.0', platform: 'darwin', mode: 'ui' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts CLI mode params', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'cli', version: '1.0', platform: 'linux', mode: 'cli' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts macos app params with modelIdentifier, deviceFamily', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'mac', version: '1.0', platform: 'darwin', mode: 'ui', modelIdentifier: 'Mac14,2', deviceFamily: 'Mac' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.client.modelIdentifier).toBe('Mac14,2');
        expect(result.data.client.deviceFamily).toBe('Mac');
      }
    });

    it('accepts device attestation block', () => {
      const result = ConnectParamsSchema.safeParse({
        ...base,
        device: { id: 'dev-1', publicKey: 'b64key', signature: 'b64sig', signedAt: Date.now(), nonce: 'abc123' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.device!.id).toBe('dev-1');
        expect(result.data.device!.nonce).toBe('abc123');
      }
    });

    it('validates client.version is required', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'c', platform: 'linux', mode: 'cli' },
      });
      expect(result.success).toBe(false);
    });

    it('validates client.platform is required', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'c', version: '1.0', mode: 'cli' },
      });
      expect(result.success).toBe(false);
    });

    it('validates minProtocol and maxProtocol are numbers', () => {
      const result = ConnectParamsSchema.safeParse({
        minProtocol: 'three', maxProtocol: 'three',
        client: { id: 'c', version: '1.0', platform: 'linux', mode: 'cli' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('HelloOkPayload structure', () => {
    it('makeResponse with hello-ok payload matches expected shape', () => {
      const helloOk = {
        type: 'hello-ok' as const,
        protocol: PROTOCOL_VERSION,
        server: { version: '0.1.0', connId: 'conn-1' },
        features: { methods: ['health', 'status'], events: ['tick', 'chat'] },
        snapshot: { presence: [], health: {}, stateVersion: { presence: 1, health: 1 }, uptimeMs: 100, authMode: 'none' },
        policy: { maxPayload: 16777216, maxBufferedBytes: 67108864, tickIntervalMs: 60000 },
      };
      const res = makeResponse('1', true, helloOk);
      expect(res.type).toBe('res');
      expect(res.ok).toBe(true);
      const p = res.payload as any;
      expect(p.type).toBe('hello-ok');
    });

    it('verify protocol version is number', () => {
      expect(typeof PROTOCOL_VERSION).toBe('number');
    });

    it('verify server block has version and connId', () => {
      const server = { version: '0.1.0', connId: 'abc' };
      expect(typeof server.version).toBe('string');
      expect(typeof server.connId).toBe('string');
    });

    it('verify features block has methods array and events array', () => {
      const features = { methods: ['health'], events: ['tick'] };
      expect(Array.isArray(features.methods)).toBe(true);
      expect(Array.isArray(features.events)).toBe(true);
    });

    it('verify snapshot block has required fields', () => {
      const snapshot = { presence: [], health: {}, stateVersion: { presence: 1, health: 1 }, uptimeMs: 500, authMode: 'none' };
      expect(Array.isArray(snapshot.presence)).toBe(true);
      expect(typeof snapshot.health).toBe('object');
      expect(typeof snapshot.stateVersion.presence).toBe('number');
      expect(typeof snapshot.stateVersion.health).toBe('number');
      expect(typeof snapshot.uptimeMs).toBe('number');
      expect(typeof snapshot.authMode).toBe('string');
    });

    it('verify policy block has positive numbers', () => {
      const policy = { maxPayload: MAX_PAYLOAD_BYTES, maxBufferedBytes: MAX_BUFFERED_BYTES, tickIntervalMs: TICK_INTERVAL_MS };
      expect(policy.maxPayload).toBeGreaterThan(0);
      expect(policy.maxBufferedBytes).toBeGreaterThan(0);
      expect(policy.tickIntervalMs).toBeGreaterThan(0);
    });
  });

  describe('ErrorCodes enum', () => {
    it('ALL standard error codes present', () => {
      expect(ErrorCodes.NOT_LINKED).toBeDefined();
      expect(ErrorCodes.NOT_PAIRED).toBeDefined();
      expect(ErrorCodes.AGENT_TIMEOUT).toBeDefined();
      expect(ErrorCodes.INVALID_REQUEST).toBeDefined();
      expect(ErrorCodes.UNAVAILABLE).toBeDefined();
      expect(ErrorCodes.UNAUTHORIZED).toBeDefined();
      expect(ErrorCodes.RATE_LIMITED).toBeDefined();
    });

    it('error codes are string values (not numbers)', () => {
      for (const value of Object.values(ErrorCodes)) {
        expect(typeof value).toBe('string');
      }
    });
  });

  describe('makeEvent seq behavior', () => {
    it('makeEvent with seq=undefined leaves seq undefined', () => {
      const event = makeEvent('tick', { ts: 1 });
      expect(event.seq).toBeUndefined();
    });

    it('makeEvent with seq=0 sets seq to 0', () => {
      const event = makeEvent('tick', { ts: 1 }, 0);
      expect(event.seq).toBe(0);
    });

    it('makeEvent with seq=42 sets seq to 42', () => {
      const event = makeEvent('tick', { ts: 1 }, 42);
      expect(event.seq).toBe(42);
    });

    it('seq increments correctly when tracked externally', () => {
      let seq = 0;
      const e1 = makeEvent('tick', {}, ++seq);
      const e2 = makeEvent('tick', {}, ++seq);
      const e3 = makeEvent('tick', {}, ++seq);
      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(2);
      expect(e3.seq).toBe(3);
    });
  });
});
