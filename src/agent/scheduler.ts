/**
 * Task Scheduler for LeanClaw
 * Handles cron, interval, and one-time scheduled tasks.
 * Includes heartbeat loop with collision avoidance.
 */
import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, HEARTBEAT_INTERVAL, HEARTBEAT_SKIP_WHEN_BUSY, TIMEZONE } from '../config.js';
import { getDueTasks, getTaskById } from '../db.js';
import { logger } from '../logger.js';
import { CollisionTracker } from '../queue/collision.js';
import type { HeartbeatConfig, ScheduledTask } from '../types.js';

/**
 * Compute the next run time for a recurring task.
 * Anchored to task's scheduled time to prevent cumulative drift.
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, { tz: TIMEZONE });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      logger.warn({ taskId: task.id, value: task.schedule_value }, 'Invalid interval value');
      return new Date(now + 60_000).toISOString();
    }
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

export interface SchedulerDeps {
  enqueueTask: (chatJid: string, taskId: string, fn: () => Promise<void>) => void;
  runTask: (task: ScheduledTask) => Promise<void>;
}

let schedulerRunning = false;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

export function startSchedulerLoop(deps: SchedulerDeps): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') continue;

        deps.enqueueTask(currentTask.chat_jid, currentTask.id, () =>
          deps.runTask(currentTask),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    schedulerTimer = setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

export function stopSchedulerLoop(): void {
  schedulerRunning = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

// --- Heartbeat ---

let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

export function startHeartbeatLoop(
  collisionTracker: CollisionTracker,
  onHeartbeat: () => Promise<void>,
): void {
  const config: HeartbeatConfig = {
    enabled: true,
    interval: HEARTBEAT_INTERVAL,
    skipWhenBusy: HEARTBEAT_SKIP_WHEN_BUSY,
  };

  logger.info({ interval: config.interval, skipWhenBusy: config.skipWhenBusy }, 'Heartbeat loop started');

  const loop = async () => {
    if (collisionTracker.shouldSkipHeartbeat(config)) {
      heartbeatTimer = setTimeout(loop, 1000); // Retry after 1s
      return;
    }

    try {
      await onHeartbeat();
    } catch (err) {
      logger.error({ err }, 'Heartbeat error');
    }

    heartbeatTimer = setTimeout(loop, config.interval);
  };

  heartbeatTimer = setTimeout(loop, config.interval);
}

export function stopHeartbeatLoop(): void {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** @internal */
export function _resetSchedulerForTests(): void {
  schedulerRunning = false;
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = null;
}
