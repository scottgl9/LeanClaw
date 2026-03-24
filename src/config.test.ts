import { describe, it, expect } from 'vitest';
import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  ASSISTANT_NAME,
  GATEWAY_PORT,
  GATEWAY_HOST,
  MAX_CONCURRENT_CONTAINERS,
  POLL_INTERVAL,
} from './config.js';

describe('isValidGroupFolder', () => {
  it('accepts valid folder names', () => {
    expect(isValidGroupFolder('main')).toBe(true);
    expect(isValidGroupFolder('my-group')).toBe(true);
    expect(isValidGroupFolder('group_123')).toBe(true);
    expect(isValidGroupFolder('A')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidGroupFolder('')).toBe(false);
  });

  it('rejects paths with traversal', () => {
    expect(isValidGroupFolder('..')).toBe(false);
    expect(isValidGroupFolder('../etc')).toBe(false);
  });

  it('rejects paths with slashes', () => {
    expect(isValidGroupFolder('a/b')).toBe(false);
    expect(isValidGroupFolder('a\\b')).toBe(false);
  });

  it('rejects reserved folders', () => {
    expect(isValidGroupFolder('global')).toBe(false);
    expect(isValidGroupFolder('Global')).toBe(false);
  });

  it('rejects folders with leading/trailing whitespace', () => {
    expect(isValidGroupFolder(' main')).toBe(false);
    expect(isValidGroupFolder('main ')).toBe(false);
  });

  it('rejects folders starting with special chars', () => {
    expect(isValidGroupFolder('.hidden')).toBe(false);
    expect(isValidGroupFolder('-dash')).toBe(false);
    expect(isValidGroupFolder('_under')).toBe(false);
  });
});

describe('resolveGroupFolderPath', () => {
  it('resolves valid folders', () => {
    const result = resolveGroupFolderPath('main');
    expect(result).toContain('groups');
    expect(result).toContain('main');
  });

  it('throws for invalid folders', () => {
    expect(() => resolveGroupFolderPath('../escape')).toThrow();
    expect(() => resolveGroupFolderPath('')).toThrow();
  });
});

describe('config defaults', () => {
  it('has sensible defaults', () => {
    expect(ASSISTANT_NAME).toBe('Andy');
    expect(GATEWAY_PORT).toBe(18789);
    expect(GATEWAY_HOST).toBe('127.0.0.1');
    expect(MAX_CONCURRENT_CONTAINERS).toBeGreaterThanOrEqual(1);
    expect(POLL_INTERVAL).toBe(2000);
  });
});
