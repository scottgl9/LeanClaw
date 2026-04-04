import { randomUUID } from 'crypto';
import type { PendingWorkItem, PendingWorkEnqueueOpts } from './types.js';

const MAX_ITEMS_PER_NODE = 64;
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export class PendingWorkQueue {
  /** nodeId → items */
  private queues = new Map<string, PendingWorkItem[]>();
  /** idempotencyKey → itemId (for dedup) */
  private idempotencyMap = new Map<string, string>();

  /**
   * Enqueue a pending work item for a node.
   */
  enqueue(opts: PendingWorkEnqueueOpts): { item: PendingWorkItem; deduped: boolean } {
    // Dedup by idempotency key
    if (opts.idempotencyKey) {
      const existingId = this.idempotencyMap.get(opts.idempotencyKey);
      if (existingId) {
        const items = this.queues.get(opts.nodeId);
        const existing = items?.find((i) => i.id === existingId);
        if (existing) {
          return { item: existing, deduped: true };
        }
        // Item was already consumed/expired, remove stale key
        this.idempotencyMap.delete(opts.idempotencyKey);
      }
    }

    const items = this.queues.get(opts.nodeId) || [];

    // Enforce max items per node
    if (items.length >= MAX_ITEMS_PER_NODE) {
      // Remove oldest expired items first
      this.purgeExpired(opts.nodeId);
      const refreshed = this.queues.get(opts.nodeId) || [];
      if (refreshed.length >= MAX_ITEMS_PER_NODE) {
        // Drop oldest item
        const dropped = refreshed.shift();
        if (dropped) {
          this.removeIdempotencyKey(dropped.id);
        }
      }
    }

    const item: PendingWorkItem = {
      id: randomUUID(),
      nodeId: opts.nodeId,
      type: opts.type,
      priority: opts.priority || 'normal',
      enqueuedAtMs: Date.now(),
      expiresAtMs: Date.now() + (opts.expiresMs || DEFAULT_EXPIRY_MS),
      payload: opts.payload,
    };

    const queue = this.queues.get(opts.nodeId) || [];
    queue.push(item);
    this.queues.set(opts.nodeId, queue);

    if (opts.idempotencyKey) {
      this.idempotencyMap.set(opts.idempotencyKey, item.id);
    }

    return { item, deduped: false };
  }

  /**
   * Drain all pending work for a node (returns and removes all items).
   */
  drain(nodeId: string): PendingWorkItem[] {
    this.purgeExpired(nodeId);
    const items = this.queues.get(nodeId) || [];
    this.queues.delete(nodeId);

    // Clean up idempotency keys
    for (const item of items) {
      this.removeIdempotencyKey(item.id);
    }

    return items;
  }

  /**
   * Pull a single item by ID.
   */
  pull(nodeId: string, itemId: string): PendingWorkItem | null {
    const items = this.queues.get(nodeId);
    if (!items) return null;

    const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1) return null;

    const item = items[idx];
    if (item.expiresAtMs < Date.now()) {
      items.splice(idx, 1);
      this.removeIdempotencyKey(item.id);
      return null; // Expired
    }

    items.splice(idx, 1);
    if (items.length === 0) this.queues.delete(nodeId);
    this.removeIdempotencyKey(item.id);
    return item;
  }

  /**
   * Acknowledge (remove) a specific item.
   */
  ack(nodeId: string, itemId: string): boolean {
    const items = this.queues.get(nodeId);
    if (!items) return false;

    const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1) return false;

    items.splice(idx, 1);
    if (items.length === 0) this.queues.delete(nodeId);
    this.removeIdempotencyKey(itemId);
    return true;
  }

  /**
   * Get the count of pending items for a node.
   */
  count(nodeId: string): number {
    return this.queues.get(nodeId)?.length || 0;
  }

  /** Clear all state (for tests) */
  clear(): void {
    this.queues.clear();
    this.idempotencyMap.clear();
  }

  private purgeExpired(nodeId: string): void {
    const items = this.queues.get(nodeId);
    if (!items) return;

    const now = Date.now();
    const alive = items.filter((i) => i.expiresAtMs >= now);

    if (alive.length !== items.length) {
      const expired = items.filter((i) => i.expiresAtMs < now);
      for (const item of expired) {
        this.removeIdempotencyKey(item.id);
      }
    }

    if (alive.length === 0) {
      this.queues.delete(nodeId);
    } else {
      this.queues.set(nodeId, alive);
    }
  }

  private removeIdempotencyKey(itemId: string): void {
    for (const [key, id] of this.idempotencyMap) {
      if (id === itemId) {
        this.idempotencyMap.delete(key);
        break;
      }
    }
  }
}
