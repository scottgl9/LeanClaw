/**
 * Pre-run Script Hooks (OpenClaw issue #49370)
 *
 * Allows scripts to run before agent execution to validate whether a run should proceed.
 * Exit codes: 0 = continue, 10 = skip (no failure count), other = fail
 */
import { exec } from 'child_process';
import { logger } from '../logger.js';
import type { PreHookConfig } from '../types.js';

export type PreHookResult = 'continue' | 'skip' | 'fail';

const DEFAULT_TIMEOUT = 30_000;

export async function executePreHook(config: PreHookConfig): Promise<PreHookResult> {
  const { command, timeout = DEFAULT_TIMEOUT, env: extraEnv } = config;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = exec(command, {
      timeout,
      env: { ...process.env, ...extraEnv },
    }, (err, stdout, stderr) => {
      const durationMs = Date.now() - startTime;

      if (err) {
        if ('killed' in err && err.killed) {
          logger.warn({ command, durationMs, timeout }, 'Pre-hook timed out');
          resolve('fail');
          return;
        }

        const exitCode = err.code;

        if (exitCode === 10) {
          logger.info({ command, durationMs, exitCode }, 'Pre-hook: skip (exit 10)');
          resolve('skip');
          return;
        }

        logger.warn({ command, durationMs, exitCode, stderr: stderr?.slice(-200) }, 'Pre-hook failed');
        resolve('fail');
        return;
      }

      logger.debug({ command, durationMs, stdout: stdout?.slice(-100) }, 'Pre-hook: continue (exit 0)');
      resolve('continue');
    });

    child.on('error', (err) => {
      logger.error({ command, err }, 'Pre-hook spawn error');
      resolve('fail');
    });
  });
}
