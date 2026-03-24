import fs from 'fs';
import os from 'os';
import path from 'path';

// --- .env reader (inlined from NanoClaw's env.ts) ---

function readEnvFile(keys: string[]): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch {
    return {};
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  return result;
}

// Read .env values (secrets stay out of process.env)
const envConfig = readEnvFile([
  'LEANCLAW_ASSISTANT_NAME',
  'LEANCLAW_GATEWAY_PORT',
  'LEANCLAW_GATEWAY_HOST',
  'LEANCLAW_GATEWAY_API_KEY',
  'LEANCLAW_ANTHROPIC_API_KEY',
  'LEANCLAW_GITHUB_TOKEN',
  'LEANCLAW_DEFAULT_PROVIDER',
  'LEANCLAW_CONTAINER_IMAGE',
  'LEANCLAW_CONTAINER_TIMEOUT',
  'LEANCLAW_MAX_CONCURRENT_CONTAINERS',
  'LEANCLAW_IDLE_TIMEOUT',
  'LEANCLAW_HEARTBEAT_INTERVAL',
  'LEANCLAW_HEARTBEAT_SKIP_WHEN_BUSY',
]);

function env(key: string): string | undefined {
  return process.env[key] || envConfig[key];
}

function envInt(key: string, fallback: number): number {
  const raw = env(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = env(key);
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
}

// --- Paths ---

const HOME_DIR = process.env.HOME || os.homedir();
const PROJECT_ROOT = process.cwd();

export const CONFIG_DIR = path.join(HOME_DIR, '.config', 'leanclaw');
export const MOUNT_ALLOWLIST_PATH = path.join(CONFIG_DIR, 'mount-allowlist.json');
export const SENDER_ALLOWLIST_PATH = path.join(CONFIG_DIR, 'sender-allowlist.json');
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');

// --- Assistant ---

export const ASSISTANT_NAME = env('LEANCLAW_ASSISTANT_NAME') || 'Andy';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// --- Gateway ---

export const GATEWAY_PORT = envInt('LEANCLAW_GATEWAY_PORT', 18789);
export const GATEWAY_HOST = env('LEANCLAW_GATEWAY_HOST') || '127.0.0.1';
export const GATEWAY_API_KEY = env('LEANCLAW_GATEWAY_API_KEY');

// --- LLM Providers ---

export const ANTHROPIC_API_KEY = env('LEANCLAW_ANTHROPIC_API_KEY');
export const GITHUB_TOKEN = env('LEANCLAW_GITHUB_TOKEN');
export const DEFAULT_PROVIDER = env('LEANCLAW_DEFAULT_PROVIDER') || 'anthropic';

// --- Container ---

export const CONTAINER_IMAGE = env('LEANCLAW_CONTAINER_IMAGE') || 'leanclaw-agent:latest';
export const CONTAINER_TIMEOUT = envInt('LEANCLAW_CONTAINER_TIMEOUT', 1800000);
export const CONTAINER_MAX_OUTPUT_SIZE = envInt('LEANCLAW_CONTAINER_MAX_OUTPUT_SIZE', 10485760);
export const MAX_CONCURRENT_CONTAINERS = Math.max(1, envInt('LEANCLAW_MAX_CONCURRENT_CONTAINERS', 5));
export const IDLE_TIMEOUT = envInt('LEANCLAW_IDLE_TIMEOUT', 1800000);

// --- Polling ---

export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const IPC_POLL_INTERVAL = 1000;

// --- Heartbeat ---

export const HEARTBEAT_INTERVAL = envInt('LEANCLAW_HEARTBEAT_INTERVAL', 60000);
export const HEARTBEAT_SKIP_WHEN_BUSY = envBool('LEANCLAW_HEARTBEAT_SKIP_WHEN_BUSY', true);

// --- Timezone ---

export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- Group folder validation ---

const GROUP_FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_FOLDERS = new Set(['global']);

export function isValidGroupFolder(folder: string): boolean {
  if (!folder) return false;
  if (folder !== folder.trim()) return false;
  if (!GROUP_FOLDER_PATTERN.test(folder)) return false;
  if (folder.includes('/') || folder.includes('\\')) return false;
  if (folder.includes('..')) return false;
  if (RESERVED_FOLDERS.has(folder.toLowerCase())) return false;
  return true;
}

export function resolveGroupFolderPath(folder: string): string {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder "${folder}"`);
  }
  const groupPath = path.resolve(GROUPS_DIR, folder);
  const rel = path.relative(GROUPS_DIR, groupPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${groupPath}`);
  }
  return groupPath;
}

export function resolveGroupIpcPath(folder: string): string {
  if (!isValidGroupFolder(folder)) {
    throw new Error(`Invalid group folder "${folder}"`);
  }
  const ipcBaseDir = path.resolve(DATA_DIR, 'ipc');
  const ipcPath = path.resolve(ipcBaseDir, folder);
  const rel = path.relative(ipcBaseDir, ipcPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes base directory: ${ipcPath}`);
  }
  return ipcPath;
}
