import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BLOCKED_PATTERNS, _resetCache, validateMount, generateAllowlistTemplate } from './mount-security.js';

let tmpDir: string;

vi.mock('../config.js', async () => {
  const actual = await vi.importActual('../config.js');
  return {
    ...actual,
    get MOUNT_ALLOWLIST_PATH() {
      return path.join(tmpDir ?? '/tmp', 'mount-allowlist.json');
    },
  };
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-test-'));
  _resetCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeAllowlist(config: unknown): void {
  fs.writeFileSync(path.join(tmpDir, 'mount-allowlist.json'), JSON.stringify(config));
}

describe('DEFAULT_BLOCKED_PATTERNS', () => {
  it('includes critical credential patterns', () => {
    expect(DEFAULT_BLOCKED_PATTERNS).toContain('.ssh');
    expect(DEFAULT_BLOCKED_PATTERNS).toContain('.gnupg');
    expect(DEFAULT_BLOCKED_PATTERNS).toContain('.aws');
    expect(DEFAULT_BLOCKED_PATTERNS).toContain('.env');
    expect(DEFAULT_BLOCKED_PATTERNS).toContain('id_rsa');
    expect(DEFAULT_BLOCKED_PATTERNS).toContain('private_key');
  });
});

describe('validateMount', () => {
  it('blocks all mounts when no allowlist exists', () => {
    const result = validateMount({ hostPath: '/tmp' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No mount allowlist configured');
  });

  it('blocks mounts with invalid container paths', () => {
    writeAllowlist({
      allowedRoots: [{ path: '/tmp', allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: false,
    });

    const result = validateMount({ hostPath: '/tmp/test', containerPath: '../escape' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Invalid container path');
  });

  it('blocks mounts for non-existent paths', () => {
    writeAllowlist({
      allowedRoots: [{ path: '/tmp', allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: false,
    });

    const result = validateMount({ hostPath: '/nonexistent/path/abc123xyz' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('does not exist');
  });

  it('blocks mounts matching blocked patterns', () => {
    // Create a temp dir with a blocked name
    const sshDir = path.join(tmpDir, '.ssh');
    fs.mkdirSync(sshDir);

    writeAllowlist({
      allowedRoots: [{ path: tmpDir, allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: false,
    });

    const result = validateMount({ hostPath: sshDir }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked pattern');
  });

  it('blocks mounts not under any allowed root', () => {
    const testDir = path.join(tmpDir, 'allowed');
    const outsideDir = path.join(tmpDir, 'outside');
    fs.mkdirSync(testDir);
    fs.mkdirSync(outsideDir);

    writeAllowlist({
      allowedRoots: [{ path: testDir, allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: false,
    });

    const result = validateMount({ hostPath: outsideDir }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not under any allowed root');
  });

  it('allows valid mounts under allowed roots', () => {
    const testDir = path.join(tmpDir, 'projects');
    const subDir = path.join(testDir, 'myrepo');
    fs.mkdirSync(testDir);
    fs.mkdirSync(subDir);

    writeAllowlist({
      allowedRoots: [{ path: testDir, allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: false,
    });

    const result = validateMount({ hostPath: subDir }, true);
    expect(result.allowed).toBe(true);
    expect(result.realHostPath).toBe(fs.realpathSync(subDir));
  });

  it('enforces read-only for non-main groups when nonMainReadOnly is true', () => {
    const testDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(testDir);

    writeAllowlist({
      allowedRoots: [{ path: tmpDir, allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: true,
    });

    const result = validateMount({ hostPath: testDir, readonly: false }, false);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });

  it('allows read-write for main group', () => {
    const testDir = path.join(tmpDir, 'projects');
    fs.mkdirSync(testDir);

    writeAllowlist({
      allowedRoots: [{ path: tmpDir, allowReadWrite: true }],
      blockedPatterns: [],
      nonMainReadOnly: true,
    });

    const result = validateMount({ hostPath: testDir, readonly: false }, true);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(false);
  });

  it('forces read-only when root does not allow read-write', () => {
    const testDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(testDir);

    writeAllowlist({
      allowedRoots: [{ path: tmpDir, allowReadWrite: false }],
      blockedPatterns: [],
      nonMainReadOnly: false,
    });

    const result = validateMount({ hostPath: testDir, readonly: false }, true);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });
});

describe('generateAllowlistTemplate', () => {
  it('returns valid JSON', () => {
    const template = generateAllowlistTemplate();
    const parsed = JSON.parse(template);
    expect(parsed.allowedRoots).toBeDefined();
    expect(parsed.blockedPatterns).toBeDefined();
    expect(parsed.nonMainReadOnly).toBe(true);
  });
});
