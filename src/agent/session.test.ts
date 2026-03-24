import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from '../db.js';
import { SessionManager } from './session.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('SessionManager', () => {
  it('stores and retrieves sessions', () => {
    const mgr = new SessionManager();
    mgr.setSession('main', 'session-abc');
    expect(mgr.getSession('main')).toBe('session-abc');
  });

  it('returns undefined for nonexistent sessions', () => {
    const mgr = new SessionManager();
    expect(mgr.getSession('nonexistent')).toBeUndefined();
  });

  it('gets all sessions', () => {
    const mgr = new SessionManager();
    mgr.setSession('main', 's1');
    mgr.setSession('other', 's2');
    expect(mgr.getAllSessions()).toEqual({ main: 's1', other: 's2' });
  });

  it('overwrites existing sessions', () => {
    const mgr = new SessionManager();
    mgr.setSession('main', 's1');
    mgr.setSession('main', 's2');
    expect(mgr.getSession('main')).toBe('s2');
  });
});
