/**
 * LeanClaw CLI
 * Basic command-line interface for operational management.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { startRuntime } from './runtime.js';
import { logger } from './logger.js';
import { GATEWAY_PORT, GATEWAY_HOST, CONTAINER_IMAGE, MAX_CONCURRENT_CONTAINERS, DEFAULT_PROVIDER } from './config.js';

const commands: Record<string, () => Promise<void>> = {
  start: async () => {
    await startRuntime();
  },

  config: async () => {
    console.log(JSON.stringify({
      gateway: { port: GATEWAY_PORT, host: GATEWAY_HOST },
      container: { image: CONTAINER_IMAGE, maxConcurrent: MAX_CONCURRENT_CONTAINERS },
      provider: DEFAULT_PROVIDER,
    }, null, 2));
  },

  version: async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    console.log(`leanclaw v${pkg.version}`);
  },

  help: async () => {
    console.log(`
LeanClaw - High-efficiency AI assistant runtime

Usage: leanclaw <command>

Commands:
  start    Start the LeanClaw runtime
  config   Show current configuration
  version  Show version
  help     Show this help message
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
