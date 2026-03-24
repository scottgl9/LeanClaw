/**
 * Plugin Loader for LeanClaw
 * Discovers and loads plugins from configured directories.
 * Compatible with OpenClaw's openclaw.plugin.json manifest format.
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { logger } from '../logger.js';
import type { PluginManifest, PluginRecord } from '../types.js';
import { PluginRegistry, getActiveRegistry } from './registry.js';

// --- Manifest schema ---

const PluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  main: z.string().optional(),
  skills: z.array(z.string()).optional(),
  channels: z.array(z.string()).optional(),
  providers: z.array(z.string()).optional(),
});

// --- LRU cache ---

const CACHE_MAX = 128;
const registryCache = new Map<string, { registry: PluginRegistry; timestamp: number }>();

function getCacheKey(dirs: string[]): string {
  return dirs.sort().join(':');
}

function getCachedRegistry(dirs: string[]): PluginRegistry | null {
  const key = getCacheKey(dirs);
  const cached = registryCache.get(key);
  if (!cached) return null;

  // Expire after 5 minutes
  if (Date.now() - cached.timestamp > 300_000) {
    registryCache.delete(key);
    return null;
  }

  return cached.registry;
}

function setCachedRegistry(dirs: string[], registry: PluginRegistry): void {
  const key = getCacheKey(dirs);

  // Evict oldest if at capacity
  if (registryCache.size >= CACHE_MAX) {
    const oldest = registryCache.keys().next().value;
    if (oldest !== undefined) registryCache.delete(oldest);
  }

  registryCache.set(key, { registry, timestamp: Date.now() });
}

// --- Discovery ---

function discoverPlugins(dirs: string[]): Array<{ manifest: PluginManifest; rootDir: string }> {
  const discovered: Array<{ manifest: PluginManifest; rootDir: string }> = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      logger.debug({ dir }, 'Plugin directory does not exist, skipping');
      continue;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      logger.warn({ dir }, 'Cannot read plugin directory');
      continue;
    }

    for (const entry of entries) {
      const pluginDir = path.join(dir, entry);

      try {
        if (!fs.statSync(pluginDir).isDirectory()) continue;
      } catch {
        continue;
      }

      // Look for openclaw.plugin.json (OpenClaw compatibility)
      const manifestPath = path.join(pluginDir, 'openclaw.plugin.json');
      if (!fs.existsSync(manifestPath)) {
        // Also check for leanclaw.plugin.json
        const leanManifestPath = path.join(pluginDir, 'leanclaw.plugin.json');
        if (!fs.existsSync(leanManifestPath)) continue;

        try {
          const raw = JSON.parse(fs.readFileSync(leanManifestPath, 'utf-8'));
          const parsed = PluginManifestSchema.parse(raw);
          discovered.push({ manifest: parsed, rootDir: pluginDir });
        } catch (err) {
          logger.warn({ path: leanManifestPath, err }, 'Invalid plugin manifest');
        }
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const parsed = PluginManifestSchema.parse(raw);
        discovered.push({ manifest: parsed, rootDir: pluginDir });
      } catch (err) {
        logger.warn({ path: manifestPath, err }, 'Invalid plugin manifest');
      }
    }
  }

  return discovered;
}

// --- Loader ---

export interface LoadPluginsOptions {
  dirs: string[];
  cache?: boolean;
}

export async function loadPlugins(options: LoadPluginsOptions): Promise<PluginRegistry> {
  const { dirs, cache = true } = options;

  if (cache) {
    const cached = getCachedRegistry(dirs);
    if (cached) {
      logger.debug({ dirs }, 'Using cached plugin registry');
      return cached;
    }
  }

  const registry = new PluginRegistry();
  const discovered = discoverPlugins(dirs);

  logger.info({ count: discovered.length, dirs }, 'Discovered plugins');

  for (const { manifest, rootDir } of discovered) {
    const record: PluginRecord = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      status: 'loaded',
      rootDir,
      manifest,
    };

    // Lazy load main module if specified
    if (manifest.main) {
      const mainPath = path.join(rootDir, manifest.main);
      if (fs.existsSync(mainPath)) {
        try {
          // Dynamic import for ESM compatibility
          const module = await import(mainPath);
          record.runtime = module;
          logger.debug({ pluginId: manifest.id, main: manifest.main }, 'Plugin module loaded');
        } catch (err) {
          record.status = 'error';
          record.error = err instanceof Error ? err.message : String(err);
          logger.error({ pluginId: manifest.id, err }, 'Failed to load plugin module');
        }
      }
    }

    registry.register(record);
  }

  if (cache) {
    setCachedRegistry(dirs, registry);
  }

  return registry;
}

export function getPlugin(id: string): PluginRecord | undefined {
  return getActiveRegistry().get(id);
}

export function listPlugins(): PluginRecord[] {
  return getActiveRegistry().list();
}
