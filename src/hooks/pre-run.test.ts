import { describe, it, expect } from 'vitest';
import { executePreHook } from './pre-run.js';

describe('executePreHook', () => {
  it('returns continue for exit code 0', async () => {
    const result = await executePreHook({ command: 'true' });
    expect(result).toBe('continue');
  });

  it('returns fail for non-zero exit code', async () => {
    const result = await executePreHook({ command: 'false' });
    expect(result).toBe('fail');
  });

  it('returns skip for exit code 10', async () => {
    const result = await executePreHook({ command: 'exit 10' });
    expect(result).toBe('skip');
  });

  it('returns fail for non-existent command', async () => {
    const result = await executePreHook({ command: 'nonexistent_command_xyz123' });
    expect(result).toBe('fail');
  });

  it('returns fail on timeout', async () => {
    const result = await executePreHook({ command: 'sleep 10', timeout: 100 });
    expect(result).toBe('fail');
  }, 10000);

  it('passes extra env vars', async () => {
    const result = await executePreHook({
      command: 'test "$MY_VAR" = "hello"',
      env: { MY_VAR: 'hello' },
    });
    expect(result).toBe('continue');
  });
});
