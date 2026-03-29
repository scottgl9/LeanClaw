import { logger } from '../logger.js';

// --- Rate limiting (sliding window per IP) ---

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimits = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let entry = rateLimits.get(ip);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimits.set(ip, entry);
  }

  // Prune old entries
  entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length > RATE_LIMIT_MAX_REQUESTS) {
    logger.warn({ ip, count: entry.timestamps.length }, 'Rate limit exceeded');
    return false;
  }

  return true;
}

// Periodic cleanup of stale entries (unref so it doesn't keep process alive)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (entry.timestamps.length === 0) rateLimits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);
cleanupTimer.unref();

// --- API key authentication ---

export function validateApiKey(token: string | undefined): boolean {
  // Read at call time so tests can set process.env before starting a server
  const key = process.env['LEANCLAW_GATEWAY_API_KEY'] || '';
  if (!key) return true; // No key configured = open
  if (!token) return false;
  return token === key;
}

// --- Per-sender/per-group rate limiting ---

const senderRateLimits = new Map<string, RateLimitEntry>();
const SENDER_RATE_LIMIT_MAX = 30; // messages per minute per sender

export function checkSenderRateLimit(senderJid: string): boolean {
  const now = Date.now();
  let entry = senderRateLimits.get(senderJid);

  if (!entry) {
    entry = { timestamps: [] };
    senderRateLimits.set(senderJid, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length > SENDER_RATE_LIMIT_MAX) {
    logger.warn({ sender: senderJid, count: entry.timestamps.length }, 'Sender rate limit exceeded');
    return false;
  }

  return true;
}

const groupRateLimits = new Map<string, RateLimitEntry>();
const GROUP_RATE_LIMIT_MAX = 60; // messages per minute per group

export function checkGroupRateLimit(groupJid: string): boolean {
  const now = Date.now();
  let entry = groupRateLimits.get(groupJid);

  if (!entry) {
    entry = { timestamps: [] };
    groupRateLimits.set(groupJid, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length > GROUP_RATE_LIMIT_MAX) {
    logger.warn({ group: groupJid, count: entry.timestamps.length }, 'Group rate limit exceeded');
    return false;
  }

  return true;
}

// --- Token extraction ---

export function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return authHeader;
}

// --- RBAC ---

export type Role = 'admin' | 'user' | 'viewer';

export interface RBACCheck {
  role: Role;
  action: string;
  target?: string;
}

// Default policy: allow all. Enterprise overrides via plugin.
let rbacPolicy: ((check: RBACCheck) => boolean) | null = null;

export function setRBACPolicy(policy: (check: RBACCheck) => boolean): void {
  rbacPolicy = policy;
}

export function checkPermission(check: RBACCheck): boolean {
  if (!rbacPolicy) return true; // Default: allow all
  return rbacPolicy(check);
}
