import { describe, it, expect, beforeEach } from 'vitest';
import { CollisionTracker } from './collision.js';

describe('CollisionTracker', () => {
  let tracker: CollisionTracker;

  beforeEach(() => {
    tracker = new CollisionTracker();
  });

  it('starts with no active cron jobs', () => {
    expect(tracker.isCronActive()).toBe(false);
    expect(tracker.getActiveCronCount()).toBe(0);
  });

  it('tracks active cron jobs', () => {
    tracker.markCronActive('job1');
    expect(tracker.isCronActive()).toBe(true);
    expect(tracker.getActiveCronCount()).toBe(1);

    tracker.markCronActive('job2');
    expect(tracker.getActiveCronCount()).toBe(2);
  });

  it('removes completed cron jobs', () => {
    tracker.markCronActive('job1');
    tracker.markCronActive('job2');
    tracker.markCronComplete('job1');
    expect(tracker.getActiveCronCount()).toBe(1);
    expect(tracker.isCronActive()).toBe(true);

    tracker.markCronComplete('job2');
    expect(tracker.isCronActive()).toBe(false);
  });

  it('shouldSkipHeartbeat returns false when skipWhenBusy is false', () => {
    tracker.markCronActive('job1');
    expect(tracker.shouldSkipHeartbeat({
      enabled: true, interval: 60000, skipWhenBusy: false,
    })).toBe(false);
  });

  it('shouldSkipHeartbeat returns false when no cron active', () => {
    expect(tracker.shouldSkipHeartbeat({
      enabled: true, interval: 60000, skipWhenBusy: true,
    })).toBe(false);
  });

  it('shouldSkipHeartbeat returns true when cron active and skipWhenBusy', () => {
    tracker.markCronActive('job1');
    expect(tracker.shouldSkipHeartbeat({
      enabled: true, interval: 60000, skipWhenBusy: true,
    })).toBe(true);
  });

  it('clear removes all jobs', () => {
    tracker.markCronActive('job1');
    tracker.markCronActive('job2');
    tracker.clear();
    expect(tracker.isCronActive()).toBe(false);
  });
});
