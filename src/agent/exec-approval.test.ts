import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalManager } from './exec-approval.js';

describe('ApprovalManager', () => {
  let broadcast: ReturnType<typeof vi.fn>;
  let manager: ApprovalManager;

  beforeEach(() => {
    broadcast = vi.fn();
    manager = new ApprovalManager(broadcast, 2000); // 2s timeout for tests
  });

  it('broadcasts exec.approval.requested on requestApproval', () => {
    manager.requestApproval('bash', { command: 'rm -rf /' }, 'run-1', 'client-1');

    expect(broadcast).toHaveBeenCalledWith('exec.approval.requested', expect.objectContaining({
      toolName: 'bash',
      runId: 'run-1',
    }));
    expect(manager.size).toBe(1);
  });

  it('resolves promise to true when approved', async () => {
    const promise = manager.requestApproval('bash', { command: 'ls' }, 'run-2', 'client-1');

    const pending = manager.getPending();
    expect(pending).toHaveLength(1);

    const approved = manager.resolveApproval(pending[0].id, true, 'admin');
    expect(approved).toBe(true);
    expect(await promise).toBe(true);
    expect(manager.size).toBe(0);
  });

  it('resolves promise to false when rejected', async () => {
    const promise = manager.requestApproval('bash', { command: 'dangerous' }, 'run-3', 'client-1');

    const pending = manager.getPending();
    const rejected = manager.resolveApproval(pending[0].id, false, 'admin');
    expect(rejected).toBe(true);
    expect(await promise).toBe(false);
  });

  it('auto-rejects after timeout', async () => {
    const shortManager = new ApprovalManager(broadcast, 100); // 100ms timeout
    const promise = shortManager.requestApproval('bash', {}, 'run-4', 'client-1');

    const result = await promise;
    expect(result).toBe(false);
    expect(shortManager.size).toBe(0);
  });

  it('returns false for unknown approval ID', () => {
    expect(manager.resolveApproval('nonexistent', true)).toBe(false);
  });

  it('lists pending approvals and cleans up expired', () => {
    manager.requestApproval('tool-a', {}, 'run-5', 'client-1');
    manager.requestApproval('tool-b', {}, 'run-6', 'client-1');

    const pending = manager.getPending();
    expect(pending).toHaveLength(2);
    expect(pending[0].toolName).toBe('tool-a');
    expect(pending[1].toolName).toBe('tool-b');
  });

  it('broadcasts exec.approval.resolved on resolve', async () => {
    const promise = manager.requestApproval('bash', {}, 'run-7', 'client-1');
    const pending = manager.getPending();
    manager.resolveApproval(pending[0].id, true, 'operator');
    await promise;

    expect(broadcast).toHaveBeenCalledWith('exec.approval.resolved', expect.objectContaining({
      approved: true,
      resolvedBy: 'operator',
    }));
  });

  it('clears all pending approvals on shutdown', async () => {
    const p1 = manager.requestApproval('tool-a', {}, 'run-8', 'client-1');
    const p2 = manager.requestApproval('tool-b', {}, 'run-9', 'client-1');

    manager.clear();

    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
    expect(manager.size).toBe(0);
  });
});
