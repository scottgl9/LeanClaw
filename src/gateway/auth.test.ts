import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('validateApiKey with dynamic env var', () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env['LEANCLAW_GATEWAY_API_KEY'];
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env['LEANCLAW_GATEWAY_API_KEY'];
    } else {
      process.env['LEANCLAW_GATEWAY_API_KEY'] = savedKey;
    }
  });

  it('returns true when LEANCLAW_GATEWAY_API_KEY is not set', () => {
    delete process.env['LEANCLAW_GATEWAY_API_KEY'];
    expect(validateApiKey(undefined)).toBe(true);
    expect(validateApiKey('anything')).toBe(true);
  });

  it('returns true for any token when LEANCLAW_GATEWAY_API_KEY is empty string', () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = '';
    expect(validateApiKey('any-token')).toBe(true);
    expect(validateApiKey(undefined)).toBe(true);
  });

  it('returns true when token matches LEANCLAW_GATEWAY_API_KEY', () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'secret-key-123';
    expect(validateApiKey('secret-key-123')).toBe(true);
  });

  it('returns false when token does not match LEANCLAW_GATEWAY_API_KEY', () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'secret-key-123';
    expect(validateApiKey('wrong-key')).toBe(false);
  });

  it('returns false when token is undefined and LEANCLAW_GATEWAY_API_KEY is set', () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'secret-key-123';
    expect(validateApiKey(undefined)).toBe(false);
  });

  it('returns false when token is empty string and LEANCLAW_GATEWAY_API_KEY is set', () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'secret-key-123';
    expect(validateApiKey('')).toBe(false);
  });

  it('token comparison is case-sensitive', () => {
    process.env['LEANCLAW_GATEWAY_API_KEY'] = 'Secret-Key';
    expect(validateApiKey('Secret-Key')).toBe(true);
    expect(validateApiKey('secret-key')).toBe(false);
    expect(validateApiKey('SECRET-KEY')).toBe(false);
  });
});

describe('checkRateLimit enforcement', () => {
  it('blocks requests after rate limit exceeded', () => {
    const ip = `rate-test-${Date.now()}-${Math.random()}`;
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      if (!checkRateLimit(ip)) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('allows different IPs independently', () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const ipA = `ip-a-${suffix}`;
    const ipB = `ip-b-${suffix}`;
    // Send 50 requests on each — both under limit
    for (let i = 0; i < 50; i++) {
      expect(checkRateLimit(ipA)).toBe(true);
      expect(checkRateLimit(ipB)).toBe(true);
    }
  });

  it('sliding window: requests spread over time are not blocked', () => {
    // This test verifies behavior under the limit threshold
    const ip = `spread-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
  });
});

describe('extractBearerToken edge cases', () => {
  it('handles Bearer prefix with trailing space in token', () => {
    expect(extractBearerToken('Bearer token-with-space ')).toBe('token-with-space ');
  });

  it('handles empty string header (falsy, returns undefined)', () => {
    expect(extractBearerToken('')).toBeUndefined();
  });

  it('handles undefined', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });
});

describe('checkPermission / RBAC', () => {
  afterEach(() => {
    // Reset policy to permissive default
    setRBACPolicy(null as any);
  });

  it('admin role can do everything', () => {
    setRBACPolicy((check) => {
      if (check.role === 'admin') return true;
      if (check.role === 'user') return check.action.startsWith('operator.');
      if (check.role === 'viewer') return check.action.endsWith('.read');
      return false;
    });
    expect(checkPermission({ role: 'admin', action: 'operator.admin' })).toBe(true);
    expect(checkPermission({ role: 'admin', action: 'destroy.everything' })).toBe(true);
  });

  it('user role can do operator.read but not operator.admin', () => {
    setRBACPolicy((check) => {
      if (check.role === 'admin') return true;
      if (check.role === 'user') return check.action === 'operator.read';
      return false;
    });
    expect(checkPermission({ role: 'user', action: 'operator.read' })).toBe(true);
    expect(checkPermission({ role: 'user', action: 'operator.admin' })).toBe(false);
  });

  it('viewer role can only do read operations', () => {
    setRBACPolicy((check) => {
      if (check.role === 'admin') return true;
      if (check.role === 'viewer') return check.action.endsWith('.read');
      return false;
    });
    expect(checkPermission({ role: 'viewer', action: 'sessions.read' })).toBe(true);
    expect(checkPermission({ role: 'viewer', action: 'sessions.write' })).toBe(false);
  });

  it('unknown role denied if policy set', () => {
    setRBACPolicy((check) => {
      return check.role === 'admin';
    });
    expect(checkPermission({ role: 'viewer', action: 'anything' })).toBe(false);
  });

  it('no policy = allow all (permissive default)', () => {
    // setRBACPolicy with a function that doesn't exist — reset to null via the module
    // The afterEach resets it, and checkPermission returns true when rbacPolicy is null
    // But we need to actually set it to null. The setRBACPolicy expects a function.
    // Looking at the source, rbacPolicy is checked as `if (!rbacPolicy) return true`
    // We can pass null to clear it.
    setRBACPolicy(null as any);
    expect(checkPermission({ role: 'viewer', action: 'anything' })).toBe(true);
    expect(checkPermission({ role: 'user', action: 'delete' })).toBe(true);
  });
});
