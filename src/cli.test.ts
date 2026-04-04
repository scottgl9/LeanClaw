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
  it('shows help with all commands', () => {
    const output = runCli('help');
    expect(output).toContain('LeanClaw');
    expect(output).toContain('start');
    expect(output).toContain('config');
    expect(output).toContain('version');
    expect(output).toContain('doctor');
    expect(output).toContain('health');
    expect(output).toContain('gateway-status');
    expect(output).toContain('plugins-list');
    expect(output).toContain('skills-list');
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

  it('shows skills list', () => {
    const output = runCli('skills-list');
    // Should either list skills or say none installed
    expect(output).toMatch(/skills|No skills/i);
  });

  it('shows plugins list', () => {
    const output = runCli('plugins-list');
    expect(output).toMatch(/plugins|No plugins/i);
  });

  it('runs doctor checks', () => {
    const output = runCli('doctor');
    expect(output).toContain('LeanClaw Doctor');
    expect(output).toContain('Docker');
    expect(output).toContain('Config');
  });
});
