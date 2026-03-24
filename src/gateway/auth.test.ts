import { describe, it, expect } from 'vitest';
import {
  checkRateLimit,
  checkSenderRateLimit,
  checkGroupRateLimit,
  validateApiKey,
  extractBearerToken,
  checkPermission,
  setRBACPolicy,
  type Role,
} from './auth.js';

describe('checkRateLimit', () => {
  it('allows requests under limit', () => {
    const ip = `test-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
  });
});

describe('checkSenderRateLimit', () => {
  it('allows messages under limit', () => {
    const sender = `sender-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkSenderRateLimit(sender)).toBe(true);
    }
  });
});

describe('checkGroupRateLimit', () => {
  it('allows messages under limit', () => {
    const group = `group-${Date.now()}`;
    for (let i = 0; i < 10; i++) {
      expect(checkGroupRateLimit(group)).toBe(true);
    }
  });
});

describe('validateApiKey', () => {
  it('returns true when no key is configured', () => {
    // GATEWAY_API_KEY is not set in test env
    expect(validateApiKey(undefined)).toBe(true);
    expect(validateApiKey('any-token')).toBe(true);
  });
});

describe('extractBearerToken', () => {
  it('extracts bearer token', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('returns raw token if no Bearer prefix', () => {
    expect(extractBearerToken('abc123')).toBe('abc123');
  });

  it('returns undefined for no header', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });
});

describe('RBAC', () => {
  it('allows all by default (no policy)', () => {
    expect(checkPermission({ role: 'viewer', action: 'read' })).toBe(true);
    expect(checkPermission({ role: 'viewer', action: 'write' })).toBe(true);
  });

  it('enforces custom policy', () => {
    setRBACPolicy((check) => {
      if (check.role === 'admin') return true;
      if (check.role === 'user' && check.action !== 'delete') return true;
      if (check.role === 'viewer' && check.action === 'read') return true;
      return false;
    });

    expect(checkPermission({ role: 'admin', action: 'delete' })).toBe(true);
    expect(checkPermission({ role: 'user', action: 'write' })).toBe(true);
    expect(checkPermission({ role: 'user', action: 'delete' })).toBe(false);
    expect(checkPermission({ role: 'viewer', action: 'read' })).toBe(true);
    expect(checkPermission({ role: 'viewer', action: 'write' })).toBe(false);

    // Reset to default
    setRBACPolicy(() => true);
  });
});
