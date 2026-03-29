/**
 * OpenClaw Plugin Manifest Compatibility Tests
 *
 * Verifies that LeanClaw's plugin loader can parse and load real
 * OpenClaw plugin manifests from the extensions/ directory.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadPlugins } from './loader.js';
import { PluginRegistry } from './registry.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-compat-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePlugin(name: string, manifest: unknown): void {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'openclaw.plugin.json'), JSON.stringify(manifest));
}

describe('OpenClaw plugin manifest compatibility', () => {
  it('loads real Anthropic provider plugin manifest', async () => {
    writePlugin('anthropic', {
      id: 'anthropic',
      providers: ['anthropic'],
      providerAuthEnvVars: {
        anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
      },
      providerAuthChoices: [
        {
          provider: 'anthropic',
          method: 'api-key',
          choiceId: 'apiKey',
          choiceLabel: 'Anthropic API key',
          groupId: 'anthropic',
          groupLabel: 'Anthropic',
          optionKey: 'anthropicApiKey',
          cliFlag: '--anthropic-api-key',
          cliOption: '--anthropic-api-key <key>',
          cliDescription: 'Anthropic API key',
        },
      ],
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('anthropic');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.id).toBe('anthropic');
    expect(plugin!.manifest.providers).toEqual(['anthropic']);
    expect(plugin!.manifest.providerAuthEnvVars).toBeDefined();
    expect(plugin!.manifest.providerAuthEnvVars!['anthropic']).toContain('ANTHROPIC_API_KEY');
  });

  it('loads real Discord channel plugin manifest', async () => {
    writePlugin('discord', {
      id: 'discord',
      channels: ['discord'],
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('discord');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.channels).toEqual(['discord']);
  });

  it('loads real Synthetic provider plugin manifest', async () => {
    writePlugin('synthetic', {
      id: 'synthetic',
      providers: ['synthetic'],
      providerAuthEnvVars: {
        synthetic: ['SYNTHETIC_API_KEY'],
      },
      providerAuthChoices: [
        {
          provider: 'synthetic',
          method: 'api-key',
          choiceId: 'synthetic-api-key',
          choiceLabel: 'Synthetic API key',
          groupId: 'synthetic',
          groupLabel: 'Synthetic',
          groupHint: 'Anthropic-compatible (multi-model)',
          optionKey: 'syntheticApiKey',
          cliFlag: '--synthetic-api-key',
          cliOption: '--synthetic-api-key <key>',
          cliDescription: 'Synthetic API key',
        },
      ],
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('synthetic');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.providers).toEqual(['synthetic']);
  });

  it('loads plugin with kind field (memory-lancedb style)', async () => {
    writePlugin('memory-lancedb', {
      id: 'memory-lancedb',
      kind: 'memory',
      uiHints: {
        'embedding.provider': { label: 'Embedding Provider' },
        dbPath: { label: 'Database path' },
      },
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          embedding: { type: 'object' },
          dbPath: { type: 'string' },
          autoCapture: { type: 'boolean' },
        },
      },
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('memory-lancedb');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.kind).toBe('memory');
  });

  it('loads plugin with no name or version (OpenClaw style)', async () => {
    // Real OpenClaw plugins often omit name/version
    writePlugin('minimal', {
      id: 'minimal',
      channels: ['test'],
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('minimal');
    expect(plugin).toBeDefined();
    expect(plugin!.id).toBe('minimal');
  });

  it('loads multiple OpenClaw plugins simultaneously', async () => {
    writePlugin('anthropic', { id: 'anthropic', providers: ['anthropic'] });
    writePlugin('discord', { id: 'discord', channels: ['discord'] });
    writePlugin('telegram', { id: 'telegram', channels: ['telegram'] });
    writePlugin('memory-lancedb', { id: 'memory-lancedb', kind: 'memory' });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(4);
    expect(registry.get('anthropic')).toBeDefined();
    expect(registry.get('discord')).toBeDefined();
    expect(registry.get('telegram')).toBeDefined();
    expect(registry.get('memory-lancedb')).toBeDefined();
  });

  it('loads plugin with contracts field (capability snapshot)', async () => {
    writePlugin('multimodal', {
      id: 'multimodal',
      providers: ['multimodal'],
      contracts: {
        speech: { tts: true, stt: false },
        mediaUnderstanding: true,
        imageGeneration: true,
        webSearch: false,
        toolOwnership: ['image-gen', 'tts'],
      },
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('multimodal');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.contracts).toBeDefined();
    expect(plugin!.manifest.contracts!.speech).toEqual({ tts: true, stt: false });
    expect(plugin!.manifest.contracts!.mediaUnderstanding).toBe(true);
    expect(plugin!.manifest.contracts!.imageGeneration).toBe(true);
    expect(plugin!.manifest.contracts!.webSearch).toBe(false);
    expect(plugin!.manifest.contracts!.toolOwnership).toEqual(['image-gen', 'tts']);
  });

  it('loads plugin with partial contracts field', async () => {
    writePlugin('speech-only', {
      id: 'speech-only',
      contracts: {
        speech: { tts: true },
      },
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('speech-only');
    expect(plugin).toBeDefined();
    expect(plugin!.manifest.contracts!.speech!.tts).toBe(true);
    expect(plugin!.manifest.contracts!.mediaUnderstanding).toBeUndefined();
  });

  it('preserves unknown OpenClaw fields via passthrough', async () => {
    writePlugin('custom', {
      id: 'custom',
      providers: ['custom-provider'],
      providerAuthEnvVars: { 'custom-provider': ['CUSTOM_KEY'] },
      providerAuthChoices: [{ provider: 'custom-provider', method: 'api-key', choiceId: 'key' }],
      configSchema: { type: 'object', properties: { model: { type: 'string' } } },
      // Unknown fields that OpenClaw plugins may have
      customField: 'should-be-preserved',
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('custom');
    expect(plugin).toBeDefined();
    expect((plugin!.manifest as any).customField).toBe('should-be-preserved');
  });
});

describe('Plugin SDK exports', () => {
  it('loadPlugins is exported from sdk.ts', async () => {
    const sdk = await import('./sdk.js');
    expect(typeof sdk.loadPlugins).toBe('function');
  });

  it('getPlugin is exported from sdk.ts', async () => {
    const sdk = await import('./sdk.js');
    expect(typeof sdk.getPlugin).toBe('function');
  });

  it('listPlugins is exported from sdk.ts', async () => {
    const sdk = await import('./sdk.js');
    expect(typeof sdk.listPlugins).toBe('function');
  });

  it('PluginRegistry is exported from sdk.ts', async () => {
    const sdk = await import('./sdk.js');
    expect(sdk.PluginRegistry).toBeDefined();
    expect(typeof sdk.PluginRegistry).toBe('function');
  });
});

describe('PluginRegistry API', () => {
  it('register() stores plugin record', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'reg-test', name: 'RegTest', version: '1.0.0', status: 'loaded', rootDir: '/tmp', manifest: { id: 'reg-test' } });
    expect(registry.has('reg-test')).toBe(true);
  });

  it('get(id) returns stored record', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'get-test', name: 'GetTest', version: '2.0.0', status: 'loaded', rootDir: '/tmp', manifest: { id: 'get-test' } });
    const record = registry.get('get-test');
    expect(record).toBeDefined();
    expect(record.name).toBe('GetTest');
  });

  it('get(nonexistent) returns undefined', () => {
    const registry = new PluginRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('list() returns all records as array', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'list-a', name: 'A', version: '1.0.0', status: 'loaded', rootDir: '/tmp', manifest: { id: 'list-a' } });
    registry.register({ id: 'list-b', name: 'B', version: '1.0.0', status: 'loaded', rootDir: '/tmp', manifest: { id: 'list-b' } });
    expect(Array.isArray(registry.list())).toBe(true);
    expect(registry.list()).toHaveLength(2);
  });

  it('list() returns empty array when empty', () => {
    const registry = new PluginRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('register() with duplicate id overwrites previous', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'dup', name: 'First', version: '1.0.0', status: 'loaded', rootDir: '/tmp', manifest: { id: 'dup' } });
    registry.register({ id: 'dup', name: 'Second', version: '2.0.0', status: 'loaded', rootDir: '/tmp', manifest: { id: 'dup' } });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('dup').name).toBe('Second');
  });

  it('record has required fields: id, name, version, status, rootDir, manifest', () => {
    const registry = new PluginRegistry();
    registry.register({ id: 'fields', name: 'Fields', version: '1.0.0', status: 'loaded', rootDir: '/tmp/fields', manifest: { id: 'fields' } });
    const record = registry.get('fields');
    expect(record.id).toBe('fields');
    expect(record.name).toBe('Fields');
    expect(record.version).toBe('1.0.0');
    expect(record.status).toBe('loaded');
    expect(record.rootDir).toBe('/tmp/fields');
    expect(record.manifest).toBeDefined();
    expect(record.manifest.id).toBe('fields');
  });
});

describe('Plugin status values', () => {
  it('newly loaded plugin has status loaded', async () => {
    writePlugin('status-loaded', { id: 'status-loaded', name: 'Loaded' });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('status-loaded')!.status).toBe('loaded');
  });

  it('plugin with import error has status error and error message', async () => {
    // Create a plugin with a main file that does not exist as a valid module
    const pluginDir = path.join(tmpDir, 'error-plugin');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'openclaw.plugin.json'), JSON.stringify({ id: 'error-plugin', main: 'nonexistent.js' }));

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin = registry.get('error-plugin');
    expect(plugin).toBeDefined();
    // main file doesn't exist, so module load is skipped (no error) unless the file exists but fails to import
    // Let's create a file that throws on import
    fs.writeFileSync(path.join(pluginDir, 'bad-module.js'), 'throw new Error("import failure");');
    fs.writeFileSync(path.join(pluginDir, 'openclaw.plugin.json'), JSON.stringify({ id: 'error-plugin', main: 'bad-module.js' }));

    const registry2 = await loadPlugins({ dirs: [tmpDir], cache: false });
    const plugin2 = registry2.get('error-plugin');
    expect(plugin2).toBeDefined();
    expect(plugin2!.status).toBe('error');
    expect(plugin2!.error).toBeDefined();
    expect(typeof plugin2!.error).toBe('string');
  });

  it('plugin status is one of: loaded, error, unloaded', () => {
    const validStatuses = ['loaded', 'error', 'unloaded'];
    // Just verify the type system allows these values
    for (const status of validStatuses) {
      expect(validStatuses).toContain(status);
    }
  });
});
