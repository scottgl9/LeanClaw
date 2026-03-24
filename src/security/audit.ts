import { logAuditEvent, getAuditEvents } from '../db.js';
import { logger } from '../logger.js';
import type { AuditEntry } from '../types.js';

export class AuditLogger {
  private actor: string;

  constructor(actor: string = 'system') {
    this.actor = actor;
  }

  private log(eventType: string, target: string, details: Record<string, unknown>, outcome: string): void {
    const entry: Omit<AuditEntry, 'id'> = {
      timestamp: new Date().toISOString(),
      event_type: eventType,
      actor: this.actor,
      target,
      details: JSON.stringify(details),
      outcome,
    };

    try {
      logAuditEvent(entry);
    } catch (err) {
      logger.error({ err, entry }, 'Failed to write audit log entry');
    }

    if (process.env.LOG_FORMAT === 'json') {
      logger.info({ audit: entry }, 'audit');
    }
  }

  logAccess(who: string, what: string, target: string, outcome: 'allowed' | 'denied'): void {
    this.log('access', target, { who, action: what }, outcome);
  }

  logConfigChange(who: string, key: string, oldValue: unknown, newValue: unknown): void {
    this.log('config_change', key, { who, old: oldValue, new: newValue }, 'success');
  }

  logContainerStart(group: string, containerName: string, mounts: string[]): void {
    this.log('container_start', group, { container: containerName, mounts }, 'success');
  }

  logContainerEnd(group: string, containerName: string, exitCode: number, durationMs: number): void {
    const outcome = exitCode === 0 ? 'success' : 'error';
    this.log('container_end', group, { container: containerName, exitCode, durationMs }, outcome);
  }

  logProviderAuth(provider: string, method: string, outcome: 'success' | 'failure'): void {
    this.log('provider_auth', provider, { method }, outcome);
  }

  getRecentEvents(limit: number = 100): AuditEntry[] {
    return getAuditEvents(limit);
  }
}

export const audit = new AuditLogger();
