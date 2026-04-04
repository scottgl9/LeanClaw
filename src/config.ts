import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

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

// --- Config file schema ---

const ConfigFileSchema = z.object({
  assistant: z.object({
    name: z.string().optional(),
  }).optional(),
  gateway: z.object({
    port: z.number().int().min(1).max(65535).optional(),
    host: z.string().optional(),
    apiKey: z.string().optional(),
  }).optional(),
  container: z.object({
    image: z.string().optional(),
    timeout: z.number().int().min(0).optional(),
    maxConcurrent: z.number().int().min(1).optional(),
    maxOutputSize: z.number().int().min(0).optional(),
    memoryLimit: z.string().optional(),
    cpuLimit: z.string().optional(),
  }).optional(),
  provider: z.object({
    default: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    githubToken: z.string().optional(),
  }).optional(),
  localProvider: z.object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
  heartbeat: z.object({
    interval: z.number().int().min(0).optional(),
    skipWhenBusy: z.boolean().optional(),
  }).optional(),
  compaction: z.object({
    model: z.string().optional(),
    autoCompact: z.boolean().optional(),
  }).optional(),
  approval: z.object({
    timeout: z.number().int().min(0).optional(),
  }).optional(),
  skills: z.object({
    dir: z.string().optional(),
  }).optional(),
  hooks: z.object({
    enabled: z.boolean().optional(),
  }).optional(),
}).strict().optional();

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** Map from config file JSON paths to LEANCLAW_* env var names */
const CONFIG_KEY_MAP: Record<string, string> = {
  'assistant.name': 'LEANCLAW_ASSISTANT_NAME',
  'gateway.port': 'LEANCLAW_GATEWAY_PORT',
  'gateway.host': 'LEANCLAW_GATEWAY_HOST',
  'gateway.apiKey': 'LEANCLAW_GATEWAY_API_KEY',
  'container.image': 'LEANCLAW_CONTAINER_IMAGE',
  'container.timeout': 'LEANCLAW_CONTAINER_TIMEOUT',
  'container.maxConcurrent': 'LEANCLAW_MAX_CONCURRENT_CONTAINERS',
  'container.maxOutputSize': 'LEANCLAW_CONTAINER_MAX_OUTPUT_SIZE',
  'container.memoryLimit': 'LEANCLAW_CONTAINER_MEMORY_LIMIT',
  'container.cpuLimit': 'LEANCLAW_CONTAINER_CPU_LIMIT',
  'provider.default': 'LEANCLAW_DEFAULT_PROVIDER',
  'provider.anthropicApiKey': 'LEANCLAW_ANTHROPIC_API_KEY',
  'provider.githubToken': 'LEANCLAW_GITHUB_TOKEN',
  'heartbeat.interval': 'LEANCLAW_HEARTBEAT_INTERVAL',
  'heartbeat.skipWhenBusy': 'LEANCLAW_HEARTBEAT_SKIP_WHEN_BUSY',
  'compaction.model': 'LEANCLAW_COMPACTION_MODEL',
  'compaction.autoCompact': 'LEANCLAW_AUTO_COMPACT',
  'approval.timeout': 'LEANCLAW_APPROVAL_TIMEOUT',
  'skills.dir': 'LEANCLAW_SKILLS_DIR',
  'hooks.enabled': 'LEANCLAW_HOOKS_ENABLED',
  'localProvider.baseUrl': 'LEANCLAW_LOCAL_LLM_BASE_URL',
  'localProvider.apiKey': 'LEANCLAW_LOCAL_LLM_API_KEY',
  'localProvider.model': 'LEANCLAW_LOCAL_LLM_MODEL',
};

/** Read and validate config file, returning flattened env-key values */
export function readConfigFile(configPath?: string): Record<string, string> {
  const filePath = configPath || path.join(os.homedir(), '.config', 'leanclaw', 'config.json');
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    return {};
  }

  const config = result.data;
  if (!config) return {};

  // Flatten nested config into LEANCLAW_* keys
  const flat: Record<string, string> = {};
  for (const [jsonPath, envKey] of Object.entries(CONFIG_KEY_MAP)) {
    const parts = jsonPath.split('.');
    let current: unknown = config;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        current = undefined;
        break;
      }
    }
    if (current !== undefined && current !== null) {
      flat[envKey] = String(current);
    }
  }

  return flat;
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
  'LEANCLAW_COMPACTION_MODEL',
  'LEANCLAW_AUTO_COMPACT',
  'LEANCLAW_APPROVAL_TIMEOUT',
  'LEANCLAW_SKILLS_DIR',
  'LEANCLAW_HOOKS_ENABLED',
  'LEANCLAW_CONTAINER_MEMORY_LIMIT',
  'LEANCLAW_CONTAINER_CPU_LIMIT',
  'LEANCLAW_LOCAL_LLM_BASE_URL',
  'LEANCLAW_LOCAL_LLM_API_KEY',
  'LEANCLAW_LOCAL_LLM_MODEL',
]);

// Read config file (lowest priority after env vars and .env file)
const configFileValues = readConfigFile();

function env(key: string): string | undefined {
  return process.env[key] || envConfig[key] || configFileValues[key];
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

// --- Compaction ---

export const COMPACTION_MODEL = env('LEANCLAW_COMPACTION_MODEL') || '';
export const AUTO_COMPACT = envBool('LEANCLAW_AUTO_COMPACT', true);

// --- Exec Approvals ---

export const APPROVAL_TIMEOUT = envInt('LEANCLAW_APPROVAL_TIMEOUT', 60000);

// --- Skills ---

export const SKILLS_DIR = env('LEANCLAW_SKILLS_DIR') || '';

// --- Hooks ---

export const HOOKS_ENABLED = envBool('LEANCLAW_HOOKS_ENABLED', true);

// --- Container Resource Limits ---

export const CONTAINER_MEMORY_LIMIT = env('LEANCLAW_CONTAINER_MEMORY_LIMIT') || '';
export const CONTAINER_CPU_LIMIT = env('LEANCLAW_CONTAINER_CPU_LIMIT') || '';

// --- Local LLM Provider (OpenAI-compatible: vLLM, SGLang, llama.cpp, Ollama, etc.) ---

export const LOCAL_LLM_BASE_URL = env('LEANCLAW_LOCAL_LLM_BASE_URL') || '';
export const LOCAL_LLM_API_KEY = env('LEANCLAW_LOCAL_LLM_API_KEY') || '';
export const LOCAL_LLM_MODEL = env('LEANCLAW_LOCAL_LLM_MODEL') || '';

// --- Timezone ---

export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- Config file path ---

export const CONFIG_FILE_PATH = path.join(CONFIG_DIR, 'config.json');

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

// --- Config file write ---

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function writeConfigFile(updates: NonNullable<ConfigFile>): void {
  const filePath = CONFIG_FILE_PATH;
  const dir = path.dirname(filePath);

  // Ensure config directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Read existing config
  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  // Deep merge
  const merged = deepMerge(existing, updates as Record<string, unknown>);

  // Validate
  const validated = ConfigFileSchema.safeParse(merged);
  if (!validated.success) {
    throw new Error(`Invalid config: ${validated.error.message}`);
  }

  // Write
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}
