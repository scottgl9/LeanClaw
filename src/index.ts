import { fileURLToPath } from 'url';
import { startRuntime } from './runtime.js';

// Re-exports for library consumers
export { initDatabase } from './db.js';
export { logger } from './logger.js';
export * from './types.js';
export * from './config.js';
export { startRuntime, getRuntime } from './runtime.js';
export { startGatewayServer } from './gateway/server.js';

// Direct-run guard (ESM-compatible)
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  startRuntime().catch((err) => {
    console.error('Fatal error starting LeanClaw:', err);
    process.exit(1);
  });
}
