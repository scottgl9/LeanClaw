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
