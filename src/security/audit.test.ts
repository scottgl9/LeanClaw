import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from '../db.js';
import { AuditLogger } from './audit.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('AuditLogger', () => {
  it('logs and retrieves access events', () => {
    const auditLogger = new AuditLogger('test-actor');
    auditLogger.logAccess('user1', 'read', 'group1', 'allowed');

    const events = auditLogger.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('access');
    expect(events[0].actor).toBe('test-actor');
    expect(events[0].outcome).toBe('allowed');

    const details = JSON.parse(events[0].details);
    expect(details.who).toBe('user1');
    expect(details.action).toBe('read');
  });

  it('logs config changes', () => {
    const auditLogger = new AuditLogger();
    auditLogger.logConfigChange('admin', 'max_containers', 5, 10);

    const events = auditLogger.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('config_change');
    const details = JSON.parse(events[0].details);
    expect(details.old).toBe(5);
    expect(details.new).toBe(10);
  });

  it('logs container lifecycle', () => {
    const auditLogger = new AuditLogger();
    auditLogger.logContainerStart('main', 'container-abc', ['/workspace']);
    auditLogger.logContainerEnd('main', 'container-abc', 0, 5000);

    const events = auditLogger.getRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('container_end');
    expect(events[0].outcome).toBe('success');
    expect(events[1].event_type).toBe('container_start');
  });

  it('logs container failure', () => {
    const auditLogger = new AuditLogger();
    auditLogger.logContainerEnd('main', 'container-abc', 1, 3000);

    const events = auditLogger.getRecentEvents();
    expect(events[0].outcome).toBe('error');
  });

  it('logs provider auth', () => {
    const auditLogger = new AuditLogger();
    auditLogger.logProviderAuth('anthropic', 'api_key', 'success');

    const events = auditLogger.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('provider_auth');
    expect(events[0].target).toBe('anthropic');
  });

  it('respects limit parameter', () => {
    const auditLogger = new AuditLogger();
    for (let i = 0; i < 5; i++) {
      auditLogger.logAccess('user', 'read', `target${i}`, 'allowed');
    }

    const events = auditLogger.getRecentEvents(3);
    expect(events).toHaveLength(3);
  });
});
