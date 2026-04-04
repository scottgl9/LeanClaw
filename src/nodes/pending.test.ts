import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingWorkQueue } from './pending.js';

describe('PendingWorkQueue', () => {
  let queue: PendingWorkQueue;

  beforeEach(() => {
    queue = new PendingWorkQueue();
  });

  afterEach(() => {
    queue.clear();
  });

  describe('enqueue / drain', () => {
    it('enqueues and drains items', () => {
      const { item, deduped } = queue.enqueue({
        nodeId: 'node-1',
        type: 'status.request',
      });

      expect(item.nodeId).toBe('node-1');
      expect(item.type).toBe('status.request');
      expect(item.priority).toBe('normal');
      expect(deduped).toBe(false);
      expect(item.id).toBeDefined();

      const drained = queue.drain('node-1');
      expect(drained).toHaveLength(1);
      expect(drained[0].id).toBe(item.id);

      // Queue should be empty after drain
      expect(queue.count('node-1')).toBe(0);
    });

    it('drains returns empty for unknown node', () => {
      expect(queue.drain('unknown')).toEqual([]);
    });

    it('supports high priority', () => {
      const { item } = queue.enqueue({
        nodeId: 'node-1',
        type: 'urgent',
        priority: 'high',
      });
      expect(item.priority).toBe('high');
    });

    it('includes payload', () => {
      const { item } = queue.enqueue({
        nodeId: 'node-1',
        type: 'test',
        payload: { key: 'value' },
      });
      expect(item.payload).toEqual({ key: 'value' });
    });
  });

  describe('pull', () => {
    it('pulls individual items', () => {
      const { item } = queue.enqueue({ nodeId: 'node-1', type: 'test' });

      const pulled = queue.pull('node-1', item.id);
      expect(pulled).not.toBeNull();
      expect(pulled!.id).toBe(item.id);

      // Item removed after pull
      expect(queue.count('node-1')).toBe(0);
    });

    it('returns null for unknown item', () => {
      expect(queue.pull('node-1', 'unknown')).toBeNull();
    });

    it('returns null for unknown node', () => {
      expect(queue.pull('unknown', 'any')).toBeNull();
    });
  });

  describe('ack', () => {
    it('acknowledges and removes item', () => {
      const { item } = queue.enqueue({ nodeId: 'node-1', type: 'test' });
      expect(queue.ack('node-1', item.id)).toBe(true);
      expect(queue.count('node-1')).toBe(0);
    });

    it('returns false for unknown item', () => {
      expect(queue.ack('node-1', 'unknown')).toBe(false);
    });

    it('returns false for unknown node', () => {
      expect(queue.ack('unknown', 'any')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('expires items on drain', () => {
      vi.useFakeTimers();

      queue.enqueue({
        nodeId: 'node-1',
        type: 'short-lived',
        expiresMs: 1000, // 1 second
      });

      // Advance past expiry
      vi.advanceTimersByTime(2000);

      const drained = queue.drain('node-1');
      expect(drained).toHaveLength(0);

      vi.useRealTimers();
    });

    it('expires items on pull', () => {
      vi.useFakeTimers();

      const { item } = queue.enqueue({
        nodeId: 'node-1',
        type: 'short-lived',
        expiresMs: 1000,
      });

      vi.advanceTimersByTime(2000);

      const pulled = queue.pull('node-1', item.id);
      expect(pulled).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('max items cap', () => {
    it('enforces max 64 items per node', () => {
      for (let i = 0; i < 65; i++) {
        queue.enqueue({ nodeId: 'node-1', type: `type-${i}` });
      }
      expect(queue.count('node-1')).toBe(64);
    });

    it('drops oldest when at capacity', () => {
      for (let i = 0; i < 64; i++) {
        queue.enqueue({ nodeId: 'node-1', type: `type-${i}` });
      }

      // This should drop item 0
      const { item: newest } = queue.enqueue({ nodeId: 'node-1', type: 'type-64' });
      const drained = queue.drain('node-1');
      expect(drained).toHaveLength(64);
      expect(drained[drained.length - 1].id).toBe(newest.id);
      expect(drained[0].type).toBe('type-1'); // type-0 was dropped
    });
  });

  describe('deduplication', () => {
    it('deduplicates by idempotency key', () => {
      const first = queue.enqueue({
        nodeId: 'node-1',
        type: 'test',
        idempotencyKey: 'key-1',
      });
      const second = queue.enqueue({
        nodeId: 'node-1',
        type: 'test',
        idempotencyKey: 'key-1',
      });

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.item.id).toBe(first.item.id);
      expect(queue.count('node-1')).toBe(1);
    });

    it('allows different idempotency keys', () => {
      queue.enqueue({ nodeId: 'node-1', type: 'test', idempotencyKey: 'key-1' });
      queue.enqueue({ nodeId: 'node-1', type: 'test', idempotencyKey: 'key-2' });
      expect(queue.count('node-1')).toBe(2);
    });

    it('allows re-enqueue after drain', () => {
      queue.enqueue({ nodeId: 'node-1', type: 'test', idempotencyKey: 'key-1' });
      queue.drain('node-1');

      const { deduped } = queue.enqueue({ nodeId: 'node-1', type: 'test', idempotencyKey: 'key-1' });
      expect(deduped).toBe(false);
    });
  });

  describe('count', () => {
    it('returns 0 for empty queue', () => {
      expect(queue.count('node-1')).toBe(0);
    });

    it('tracks item count', () => {
      queue.enqueue({ nodeId: 'node-1', type: 'a' });
      queue.enqueue({ nodeId: 'node-1', type: 'b' });
      expect(queue.count('node-1')).toBe(2);
    });
  });
});
