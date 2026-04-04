/**
 * Exec Approval Manager
 * Manages pending tool execution approvals with timeout-based auto-rejection.
 * Gateway broadcasts approval requests; operators resolve via exec.approval.resolve.
 */
import { randomUUID } from 'crypto';
import { APPROVAL_TIMEOUT } from '../config.js';
import { logger } from '../logger.js';
import type { PendingApproval } from '../types.js';

type BroadcastFn = (event: string, payload: Record<string, unknown>) => void;

interface PendingEntry {
  approval: PendingApproval;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalManager {
  private pending = new Map<string, PendingEntry>();
  private broadcast: BroadcastFn;
  private timeout: number;

  constructor(broadcast: BroadcastFn, timeout?: number) {
    this.broadcast = broadcast;
    this.timeout = timeout || APPROVAL_TIMEOUT;
  }

  /** Request approval for a tool execution. Returns a promise that resolves to approved/rejected. */
  requestApproval(toolName: string, args: unknown, runId: string, clientId: string): Promise<boolean> {
    const id = randomUUID();
    const now = Date.now();

    const approval: PendingApproval = {
      id,
      runId,
      toolName,
      args,
      requestedAt: now,
      expiresAt: now + this.timeout,
      clientId,
    };

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        logger.warn({ approvalId: id, toolName }, 'Approval request timed out, auto-rejecting');
        resolve(false);
      }, this.timeout);

      this.pending.set(id, { approval, resolve, timer });

      // Broadcast to all connected operators
      this.broadcast('exec.approval.requested', {
        id,
        runId,
        toolName,
        args,
        requestedAt: now,
        expiresAt: now + this.timeout,
      });

      logger.info({ approvalId: id, toolName, runId }, 'Approval requested');
    });
  }

  /** Resolve a pending approval (approve or reject) */
  resolveApproval(approvalId: string, approved: boolean, resolvedBy?: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(approvalId);

    entry.resolve(approved);

    this.broadcast('exec.approval.resolved', {
      id: approvalId,
      approved,
      resolvedBy: resolvedBy || 'unknown',
    });

    logger.info({ approvalId, approved, resolvedBy }, 'Approval resolved');
    return true;
  }

  /** List all pending approvals */
  getPending(): PendingApproval[] {
    const now = Date.now();
    const result: PendingApproval[] = [];

    for (const [id, entry] of this.pending) {
      if (entry.approval.expiresAt < now) {
        // Expired — clean up
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve(false);
        continue;
      }
      result.push(entry.approval);
    }

    return result;
  }

  /** Clear all pending approvals (for shutdown) */
  clear(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
