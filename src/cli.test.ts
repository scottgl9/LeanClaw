import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const CLI_PATH = path.resolve('src/cli.ts');

function runCli(args: string): string {
  try {
    return execSync(`npx tsx ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, LOG_LEVEL: 'silent' },
    }).trim();
  } catch (err: any) {
    return (err.stdout || '').trim() + (err.stderr || '').trim();
  }
}

describe('CLI', () => {
  it('shows help', () => {
    const output = runCli('help');
    expect(output).toContain('LeanClaw');
    expect(output).toContain('start');
    expect(output).toContain('config');
    expect(output).toContain('version');
  });

  it('shows config', () => {
    const output = runCli('config');
    const config = JSON.parse(output);
    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.host).toBe('127.0.0.1');
    expect(config.provider).toBe('anthropic');
  });

  it('shows version', () => {
    const output = runCli('version');
    expect(output).toMatch(/leanclaw v\d+\.\d+\.\d+/);
  });

  it('rejects unknown commands', () => {
    const output = runCli('nonexistent');
    expect(output).toContain('Unknown command');
  });
});
