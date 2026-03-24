import { describe, it, expect } from 'vitest';
import {
  RequestFrameSchema,
  ConnectParamsSchema,
  makeResponse,
  makeEvent,
  PROTOCOL_VERSION,
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
});
