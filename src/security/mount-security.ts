/**
 * Mount Security Module for LeanClaw
 *
 * Validates additional mounts against an allowlist stored OUTSIDE the project root.
 * This prevents container agents from modifying security configuration.
 *
 * Allowlist location: ~/.config/leanclaw/mount-allowlist.json
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MOUNT_ALLOWLIST_PATH } from '../config.js';
import { logger } from '../logger.js';
import type { AdditionalMount, AllowedRoot, MountAllowlist } from '../types.js';

let cachedAllowlist: MountAllowlist | null = null;
let allowlistLoadError: string | null = null;

export const DEFAULT_BLOCKED_PATTERNS = [
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.azure',
  '.gcloud',
  '.kube',
  '.docker',
  'credentials',
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'private_key',
  '.secret',
];

/** Reset cached state — for tests only */
export function _resetCache(): void {
  cachedAllowlist = null;
  allowlistLoadError = null;
}

export function loadMountAllowlist(): MountAllowlist | null {
  if (cachedAllowlist !== null) return cachedAllowlist;
  if (allowlistLoadError !== null) return null;

  try {
    if (!fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
      allowlistLoadError = `Mount allowlist not found at ${MOUNT_ALLOWLIST_PATH}`;
      logger.warn(
        { path: MOUNT_ALLOWLIST_PATH },
        'Mount allowlist not found - additional mounts will be BLOCKED',
      );
      return null;
    }

    const content = fs.readFileSync(MOUNT_ALLOWLIST_PATH, 'utf-8');
    const allowlist = JSON.parse(content) as MountAllowlist;

    if (!Array.isArray(allowlist.allowedRoots)) throw new Error('allowedRoots must be an array');
    if (!Array.isArray(allowlist.blockedPatterns)) throw new Error('blockedPatterns must be an array');
    if (typeof allowlist.nonMainReadOnly !== 'boolean') throw new Error('nonMainReadOnly must be a boolean');

    // Merge with default blocked patterns
    allowlist.blockedPatterns = [...new Set([...DEFAULT_BLOCKED_PATTERNS, ...allowlist.blockedPatterns])];

    cachedAllowlist = allowlist;
    logger.info(
      { path: MOUNT_ALLOWLIST_PATH, allowedRoots: allowlist.allowedRoots.length, blockedPatterns: allowlist.blockedPatterns.length },
      'Mount allowlist loaded successfully',
    );

    return cachedAllowlist;
  } catch (err) {
    allowlistLoadError = err instanceof Error ? err.message : String(err);
    logger.error({ path: MOUNT_ALLOWLIST_PATH, error: allowlistLoadError }, 'Failed to load mount allowlist - additional mounts will be BLOCKED');
    return null;
  }
}

function expandPath(p: string): string {
  const homeDir = process.env.HOME || os.homedir();
  if (p.startsWith('~/')) return path.join(homeDir, p.slice(2));
  if (p === '~') return homeDir;
  return path.resolve(p);
}

function getRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function matchesBlockedPattern(realPath: string, blockedPatterns: string[]): string | null {
  const pathParts = realPath.split(path.sep);
  for (const pattern of blockedPatterns) {
    for (const part of pathParts) {
      if (part === pattern || part.includes(pattern)) return pattern;
    }
    if (realPath.includes(pattern)) return pattern;
  }
  return null;
}

function findAllowedRoot(realPath: string, allowedRoots: AllowedRoot[]): AllowedRoot | null {
  for (const root of allowedRoots) {
    const expandedRoot = expandPath(root.path);
    const realRoot = getRealPath(expandedRoot);
    if (realRoot === null) continue;

    const relative = path.relative(realRoot, realPath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return root;
    }
  }
  return null;
}

function isValidContainerPath(containerPath: string): boolean {
  if (containerPath.includes('..')) return false;
  if (containerPath.startsWith('/')) return false;
  if (!containerPath || containerPath.trim() === '') return false;
  return true;
}

export interface MountValidationResult {
  allowed: boolean;
  reason: string;
  realHostPath?: string;
  resolvedContainerPath?: string;
  effectiveReadonly?: boolean;
}

export function validateMount(mount: AdditionalMount, isMain: boolean): MountValidationResult {
  const allowlist = loadMountAllowlist();

  if (allowlist === null) {
    return { allowed: false, reason: `No mount allowlist configured at ${MOUNT_ALLOWLIST_PATH}` };
  }

  const containerPath = mount.containerPath || path.basename(mount.hostPath);

  if (!isValidContainerPath(containerPath)) {
    return { allowed: false, reason: `Invalid container path: "${containerPath}" - must be relative, non-empty, and not contain ".."` };
  }

  const expandedPath = expandPath(mount.hostPath);
  const realPath = getRealPath(expandedPath);

  if (realPath === null) {
    return { allowed: false, reason: `Host path does not exist: "${mount.hostPath}" (expanded: "${expandedPath}")` };
  }

  const blockedMatch = matchesBlockedPattern(realPath, allowlist.blockedPatterns);
  if (blockedMatch !== null) {
    return { allowed: false, reason: `Path matches blocked pattern "${blockedMatch}": "${realPath}"` };
  }

  const allowedRoot = findAllowedRoot(realPath, allowlist.allowedRoots);
  if (allowedRoot === null) {
    return {
      allowed: false,
      reason: `Path "${realPath}" is not under any allowed root. Allowed roots: ${allowlist.allowedRoots.map((r) => expandPath(r.path)).join(', ')}`,
    };
  }

  const requestedReadWrite = mount.readonly === false;
  let effectiveReadonly = true;

  if (requestedReadWrite) {
    if (!isMain && allowlist.nonMainReadOnly) {
      effectiveReadonly = true;
    } else if (!allowedRoot.allowReadWrite) {
      effectiveReadonly = true;
    } else {
      effectiveReadonly = false;
    }
  }

  return {
    allowed: true,
    reason: `Allowed under root "${allowedRoot.path}"${allowedRoot.description ? ` (${allowedRoot.description})` : ''}`,
    realHostPath: realPath,
    resolvedContainerPath: containerPath,
    effectiveReadonly,
  };
}

export function validateAdditionalMounts(
  mounts: AdditionalMount[],
  groupName: string,
  isMain: boolean,
): Array<{ hostPath: string; containerPath: string; readonly: boolean }> {
  const validatedMounts: Array<{ hostPath: string; containerPath: string; readonly: boolean }> = [];

  for (const mount of mounts) {
    const result = validateMount(mount, isMain);

    if (result.allowed) {
      validatedMounts.push({
        hostPath: result.realHostPath!,
        containerPath: `/workspace/extra/${result.resolvedContainerPath}`,
        readonly: result.effectiveReadonly!,
      });
      logger.debug({ group: groupName, hostPath: result.realHostPath, readonly: result.effectiveReadonly }, 'Mount validated');
    } else {
      logger.warn({ group: groupName, requestedPath: mount.hostPath, reason: result.reason }, 'Additional mount REJECTED');
    }
  }

  return validatedMounts;
}

export function generateAllowlistTemplate(): string {
  const template: MountAllowlist = {
    allowedRoots: [
      { path: '~/projects', allowReadWrite: true, description: 'Development projects' },
      { path: '~/repos', allowReadWrite: true, description: 'Git repositories' },
      { path: '~/Documents/work', allowReadWrite: false, description: 'Work documents (read-only)' },
    ],
    blockedPatterns: ['password', 'secret', 'token'],
    nonMainReadOnly: true,
  };
  return JSON.stringify(template, null, 2);
}
