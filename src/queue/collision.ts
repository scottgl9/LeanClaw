/**
 * Heartbeat-Cron Collision Avoidance (OpenClaw issue #50773)
 *
 * Tracks active cron jobs and skips heartbeats when cron lanes are busy.
 * Prevents resource contention in resource-constrained environments.
 */
import { logger } from '../logger.js';
import type { HeartbeatConfig } from '../types.js';

export class CollisionTracker {
  private activeCronJobs = new Set<string>();

  markCronActive(jobId: string): void {
    this.activeCronJobs.add(jobId);
    logger.debug({ jobId, activeCount: this.activeCronJobs.size }, 'Cron job started');
  }

  markCronComplete(jobId: string): void {
    this.activeCronJobs.delete(jobId);
    logger.debug({ jobId, activeCount: this.activeCronJobs.size }, 'Cron job completed');
  }

  isCronActive(): boolean {
    return this.activeCronJobs.size > 0;
  }

  getActiveCronCount(): number {
    return this.activeCronJobs.size;
  }

  shouldSkipHeartbeat(config: HeartbeatConfig): boolean {
    if (!config.skipWhenBusy) return false;
    if (!this.isCronActive()) return false;

    logger.debug(
      { activeCronJobs: this.activeCronJobs.size },
      'Skipping heartbeat — cron lane active',
    );
    return true;
  }

  clear(): void {
    this.activeCronJobs.clear();
  }
}
