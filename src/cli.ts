/**
 * LeanClaw CLI
 * Command-line interface for operational management.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { startRuntime } from './runtime.js';
import { logger } from './logger.js';
import {
  GATEWAY_PORT, GATEWAY_HOST, CONTAINER_IMAGE,
  MAX_CONCURRENT_CONTAINERS, DEFAULT_PROVIDER,
  ANTHROPIC_API_KEY, GITHUB_TOKEN,
  CONFIG_DIR, CONFIG_FILE_PATH,
} from './config.js';

function getVersion(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/** Query the running gateway via HTTP */
async function queryGateway(endpoint: string): Promise<unknown> {
  const url = `http://${GATEWAY_HOST}:${GATEWAY_PORT}${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gateway returned ${res.status}: ${await res.text()}`);
  return res.json();
}

const commands: Record<string, () => Promise<void>> = {
  start: async () => {
    await startRuntime();
  },

  config: async () => {
    console.log(JSON.stringify({
      gateway: { port: GATEWAY_PORT, host: GATEWAY_HOST },
      container: { image: CONTAINER_IMAGE, maxConcurrent: MAX_CONCURRENT_CONTAINERS },
      provider: DEFAULT_PROVIDER,
      configDir: CONFIG_DIR,
      configFile: CONFIG_FILE_PATH,
    }, null, 2));
  },

  version: async () => {
    console.log(`leanclaw v${getVersion()}`);
  },

  doctor: async () => {
    console.log('LeanClaw Doctor\n');
    const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string }> = [];

    // Check Docker
    try {
      execSync('docker info', { stdio: 'pipe' });
      checks.push({ name: 'Docker', status: 'ok', detail: 'Docker daemon is running' });
    } catch {
      checks.push({ name: 'Docker', status: 'fail', detail: 'Docker is not running or not installed' });
    }

    // Check config directory
    if (fs.existsSync(CONFIG_DIR)) {
      checks.push({ name: 'Config dir', status: 'ok', detail: CONFIG_DIR });
    } else {
      checks.push({ name: 'Config dir', status: 'warn', detail: `${CONFIG_DIR} does not exist (will be created on first use)` });
    }

    // Check config file
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      checks.push({ name: 'Config file', status: 'ok', detail: CONFIG_FILE_PATH });
    } else {
      checks.push({ name: 'Config file', status: 'warn', detail: 'No config.json found (using defaults + env vars)' });
    }

    // Check providers
    if (ANTHROPIC_API_KEY) {
      checks.push({ name: 'Anthropic', status: 'ok', detail: 'API key configured' });
    } else {
      checks.push({ name: 'Anthropic', status: 'warn', detail: 'No API key (set LEANCLAW_ANTHROPIC_API_KEY)' });
    }

    if (GITHUB_TOKEN) {
      checks.push({ name: 'GitHub Copilot', status: 'ok', detail: 'Token configured' });
    } else {
      checks.push({ name: 'GitHub Copilot', status: 'warn', detail: 'No token (set LEANCLAW_GITHUB_TOKEN)' });
    }

    // Check port availability
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://${GATEWAY_HOST}:${GATEWAY_PORT}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        checks.push({ name: 'Gateway port', status: 'warn', detail: `Port ${GATEWAY_PORT} already in use (gateway may be running)` });
      }
    } catch {
      checks.push({ name: 'Gateway port', status: 'ok', detail: `Port ${GATEWAY_PORT} is available` });
    }

    // Check container image
    try {
      execSync(`docker image inspect ${CONTAINER_IMAGE}`, { stdio: 'pipe' });
      checks.push({ name: 'Container image', status: 'ok', detail: CONTAINER_IMAGE });
    } catch {
      checks.push({ name: 'Container image', status: 'warn', detail: `Image "${CONTAINER_IMAGE}" not found locally` });
    }

    // Print results
    const icons = { ok: '✓', warn: '!', fail: '✗' };
    for (const check of checks) {
      const icon = icons[check.status];
      const color = check.status === 'ok' ? '\x1b[32m' : check.status === 'warn' ? '\x1b[33m' : '\x1b[31m';
      console.log(`  ${color}${icon}\x1b[0m ${check.name}: ${check.detail}`);
    }

    const failures = checks.filter((c) => c.status === 'fail');
    if (failures.length > 0) {
      console.log(`\n${failures.length} issue(s) require attention.`);
      process.exit(1);
    } else {
      console.log('\nAll checks passed.');
    }
  },

  health: async () => {
    try {
      const health = await queryGateway('/health');
      console.log(JSON.stringify(health, null, 2));
    } catch (err) {
      console.error(`Cannot reach gateway at ${GATEWAY_HOST}:${GATEWAY_PORT}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },

  'gateway-status': async () => {
    try {
      const health = await queryGateway('/health') as Record<string, unknown>;
      const metrics = await queryGateway('/metrics') as Record<string, unknown>;
      console.log('Gateway Status\n');
      console.log(`  Status:     ${health.status}`);
      console.log(`  Uptime:     ${Math.round((health.uptime as number) || 0)}s`);
      console.log(`  Memory:     ${health.memoryUsageMb || 0} MB`);
      console.log(`  Containers: ${metrics.activeContainers || 0}`);
      console.log(`  Channels:   ${metrics.connectedChannels || 0}`);
    } catch (err) {
      console.error(`Gateway not reachable at ${GATEWAY_HOST}:${GATEWAY_PORT}`);
      process.exit(1);
    }
  },

  'plugins-list': async () => {
    try {
      // Import plugin listing
      const { listPlugins } = await import('./plugins/loader.js');
      const plugins = listPlugins();
      if (plugins.length === 0) {
        console.log('No plugins loaded.');
      } else {
        console.log('Loaded plugins:\n');
        for (const p of plugins) {
          console.log(`  ${p.name} v${p.version} [${p.status}] (${p.id})`);
        }
      }
    } catch {
      console.log('No plugins loaded.');
    }
  },

  'skills-list': async () => {
    const { listSkills } = await import('./skills/manager.js');
    const skills = listSkills();
    if (skills.length === 0) {
      console.log('No skills installed.');
    } else {
      console.log('Installed skills:\n');
      for (const s of skills) {
        const status = s.status === 'error' ? `[error: ${s.error}]` : '';
        console.log(`  ${s.name} v${s.version} ${status}`);
        if (s.description) console.log(`    ${s.description}`);
      }
    }
  },

  help: async () => {
    console.log(`
LeanClaw - High-efficiency AI assistant runtime

Usage: leanclaw <command>

Commands:
  start          Start the LeanClaw runtime
  config         Show current configuration
  doctor         Run diagnostic checks
  health         Query running gateway health
  gateway-status Show gateway status and metrics
  plugins-list   List loaded plugins
  skills-list    List installed skills
  version        Show version
  help           Show this help message
`.trim());
  },
};

async function main(): Promise<void> {
  const command = process.argv[2] || 'start';

  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    await commands.help();
    process.exit(1);
  }

  try {
    await handler();
  } catch (err) {
    logger.fatal({ err }, 'Fatal error');
    process.exit(1);
  }
}

main();
