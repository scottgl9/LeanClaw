import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  readConfigFile,
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

describe('readConfigFile', () => {
  const tmpDir = path.join(os.tmpdir(), `leanclaw-config-test-${Date.now()}`);
  const configPath = path.join(tmpDir, 'config.json');

  it('returns empty object for missing file', () => {
    const result = readConfigFile('/nonexistent/path/config.json');
    expect(result).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, 'not json {{{');
    const result = readConfigFile(configPath);
    expect(result).toEqual({});
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty object for schema-invalid config', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: 'not-a-number' } }));
    const result = readConfigFile(configPath);
    expect(result).toEqual({});
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('parses valid config file and maps to env var keys', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      assistant: { name: 'TestBot' },
      gateway: { port: 9999, host: '0.0.0.0', apiKey: 'test-key' },
      container: { image: 'my-image:latest', timeout: 60000, maxConcurrent: 3 },
      provider: { default: 'copilot', anthropicApiKey: 'sk-test' },
      heartbeat: { interval: 30000, skipWhenBusy: false },
    }));
    const result = readConfigFile(configPath);
    expect(result['LEANCLAW_ASSISTANT_NAME']).toBe('TestBot');
    expect(result['LEANCLAW_GATEWAY_PORT']).toBe('9999');
    expect(result['LEANCLAW_GATEWAY_HOST']).toBe('0.0.0.0');
    expect(result['LEANCLAW_GATEWAY_API_KEY']).toBe('test-key');
    expect(result['LEANCLAW_CONTAINER_IMAGE']).toBe('my-image:latest');
    expect(result['LEANCLAW_CONTAINER_TIMEOUT']).toBe('60000');
    expect(result['LEANCLAW_MAX_CONCURRENT_CONTAINERS']).toBe('3');
    expect(result['LEANCLAW_DEFAULT_PROVIDER']).toBe('copilot');
    expect(result['LEANCLAW_ANTHROPIC_API_KEY']).toBe('sk-test');
    expect(result['LEANCLAW_HEARTBEAT_INTERVAL']).toBe('30000');
    expect(result['LEANCLAW_HEARTBEAT_SKIP_WHEN_BUSY']).toBe('false');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('handles partial config with only some sections', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      gateway: { port: 8080 },
    }));
    const result = readConfigFile(configPath);
    expect(result['LEANCLAW_GATEWAY_PORT']).toBe('8080');
    expect(result['LEANCLAW_ASSISTANT_NAME']).toBeUndefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects unknown keys with strict schema', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      unknownSection: { foo: 'bar' },
    }));
    const result = readConfigFile(configPath);
    expect(result).toEqual({});
    fs.rmSync(tmpDir, { recursive: true });
  });
});
