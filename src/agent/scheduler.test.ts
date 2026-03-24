import { describe, it, expect } from 'vitest';
import { computeNextRun } from './scheduler.js';
import type { ScheduledTask } from '../types.js';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task1',
    group_folder: 'main',
    chat_jid: 'chat1',
    prompt: 'test',
    schedule_type: 'cron',
    schedule_value: '0 * * * *',
    context_mode: 'isolated',
    next_run: new Date().toISOString(),
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeNextRun', () => {
  it('returns null for once tasks', () => {
    const task = makeTask({ schedule_type: 'once' });
    expect(computeNextRun(task)).toBeNull();
  });

  it('computes next cron run', () => {
    const task = makeTask({ schedule_type: 'cron', schedule_value: '0 * * * *' });
    const next = computeNextRun(task);
    expect(next).toBeDefined();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it('computes next interval run (anchored)', () => {
    const now = Date.now();
    const task = makeTask({
      schedule_type: 'interval',
      schedule_value: '60000',
      next_run: new Date(now - 30000).toISOString(), // 30s ago
    });
    const next = computeNextRun(task);
    expect(next).toBeDefined();
    const nextTime = new Date(next!).getTime();
    expect(nextTime).toBeGreaterThan(now);
    // Should be anchored to next_run + interval, not now + interval
    expect(nextTime).toBeLessThanOrEqual(now + 60000);
  });

  it('skips past missed intervals', () => {
    const now = Date.now();
    const task = makeTask({
      schedule_type: 'interval',
      schedule_value: '60000',
      next_run: new Date(now - 180000).toISOString(), // 3 min ago
    });
    const next = computeNextRun(task);
    const nextTime = new Date(next!).getTime();
    expect(nextTime).toBeGreaterThan(now);
  });

  it('handles invalid interval gracefully', () => {
    const task = makeTask({
      schedule_type: 'interval',
      schedule_value: 'invalid',
    });
    const next = computeNextRun(task);
    expect(next).toBeDefined();
  });
});
