import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadPlugins } from './loader.js';
import { PluginRegistry } from './registry.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createPlugin(name: string, manifest: unknown): string {
  const pluginDir = path.join(tmpDir, name);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'openclaw.plugin.json'),
    JSON.stringify(manifest),
  );
  return pluginDir;
}

describe('loadPlugins', () => {
  it('discovers plugins from directories', async () => {
    createPlugin('test-plugin', {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
    });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('test-plugin')).toBeDefined();
    expect(registry.get('test-plugin')!.name).toBe('Test Plugin');
  });

  it('discovers multiple plugins', async () => {
    createPlugin('plugin-a', { id: 'a', name: 'A', version: '1.0.0' });
    createPlugin('plugin-b', { id: 'b', name: 'B', version: '2.0.0' });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(2);
  });

  it('skips directories without manifests', async () => {
    fs.mkdirSync(path.join(tmpDir, 'not-a-plugin'), { recursive: true });
    createPlugin('real-plugin', { id: 'real', name: 'Real', version: '1.0.0' });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(1);
  });

  it('skips invalid manifests', async () => {
    const pluginDir = path.join(tmpDir, 'bad-plugin');
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'openclaw.plugin.json'), '{ invalid json }');

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(0);
  });

  it('skips non-existent directories', async () => {
    const registry = await loadPlugins({
      dirs: ['/nonexistent/path/abc123'],
      cache: false,
    });
    expect(registry.list()).toHaveLength(0);
  });

  it('supports leanclaw.plugin.json manifests', async () => {
    const pluginDir = path.join(tmpDir, 'lean-plugin');
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(
      path.join(pluginDir, 'leanclaw.plugin.json'),
      JSON.stringify({ id: 'lean', name: 'Lean Plugin', version: '1.0.0' }),
    );

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('lean')!.name).toBe('Lean Plugin');
  });
});

describe('PluginRegistry', () => {
  it('register and get', () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'test', name: 'Test', version: '1.0.0',
      status: 'loaded', rootDir: '/tmp', manifest: { id: 'test', name: 'Test', version: '1.0.0' },
    });
    expect(registry.get('test')).toBeDefined();
    expect(registry.has('test')).toBe(true);
  });

  it('unload', () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'test', name: 'Test', version: '1.0.0',
      status: 'loaded', rootDir: '/tmp', manifest: { id: 'test', name: 'Test', version: '1.0.0' },
    });
    expect(registry.unload('test')).toBe(true);
    expect(registry.has('test')).toBe(false);
    expect(registry.unload('nonexistent')).toBe(false);
  });

  it('list returns all plugins', () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'a', name: 'A', version: '1.0.0',
      status: 'loaded', rootDir: '/tmp', manifest: { id: 'a', name: 'A', version: '1.0.0' },
    });
    registry.register({
      id: 'b', name: 'B', version: '2.0.0',
      status: 'loaded', rootDir: '/tmp', manifest: { id: 'b', name: 'B', version: '2.0.0' },
    });
    expect(registry.list()).toHaveLength(2);
  });
});

describe('OpenClaw manifest field compatibility', () => {
  it('accepts manifest with kind field', async () => {
    createPlugin('kind-plugin', { id: 'kind-p', kind: 'memory' });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('kind-p')!.manifest.kind).toBe('memory');
  });

  it('accepts manifest with contracts.speech.tts and contracts.speech.stt', async () => {
    createPlugin('speech-plugin', { id: 'speech-p', contracts: { speech: { tts: true, stt: true } } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const m = registry.get('speech-p')!.manifest;
    expect(m.contracts!.speech!.tts).toBe(true);
    expect(m.contracts!.speech!.stt).toBe(true);
  });

  it('accepts manifest with contracts.mediaUnderstanding', async () => {
    createPlugin('media-plugin', { id: 'media-p', contracts: { mediaUnderstanding: true } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('media-p')!.manifest.contracts!.mediaUnderstanding).toBe(true);
  });

  it('accepts manifest with contracts.imageGeneration', async () => {
    createPlugin('img-plugin', { id: 'img-p', contracts: { imageGeneration: true } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('img-p')!.manifest.contracts!.imageGeneration).toBe(true);
  });

  it('accepts manifest with contracts.webSearch', async () => {
    createPlugin('web-plugin', { id: 'web-p', contracts: { webSearch: true } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('web-p')!.manifest.contracts!.webSearch).toBe(true);
  });

  it('accepts manifest with contracts.toolOwnership array', async () => {
    createPlugin('tools-plugin', { id: 'tools-p', contracts: { toolOwnership: ['tool-a', 'tool-b'] } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('tools-p')!.manifest.contracts!.toolOwnership).toEqual(['tool-a', 'tool-b']);
  });

  it('accepts manifest with configSchema object', async () => {
    createPlugin('config-plugin', { id: 'config-p', configSchema: { type: 'object', properties: { key: { type: 'string' } } } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('config-p')!.manifest.configSchema).toBeDefined();
  });

  it('accepts manifest with uiHints object', async () => {
    createPlugin('ui-plugin', { id: 'ui-p', uiHints: { model: { label: 'Model Name' } } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect((registry.get('ui-p')!.manifest as any).uiHints).toBeDefined();
  });

  it('accepts manifest with providerAuthEnvVars', async () => {
    createPlugin('auth-env-plugin', { id: 'auth-env-p', providerAuthEnvVars: { myProvider: ['MY_KEY'] } });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('auth-env-p')!.manifest.providerAuthEnvVars!['myProvider']).toEqual(['MY_KEY']);
  });

  it('accepts manifest with providerAuthChoices', async () => {
    createPlugin('auth-choice-plugin', { id: 'auth-choice-p', providerAuthChoices: [{ method: 'api-key' }] });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('auth-choice-p')!.manifest.providerAuthChoices).toHaveLength(1);
  });

  it('all extra/unknown fields preserved via passthrough()', async () => {
    createPlugin('passthrough-plugin', { id: 'pt-p', myCustomField: 'preserved', anotherField: 42 });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    const m = registry.get('pt-p')!.manifest as any;
    expect(m.myCustomField).toBe('preserved');
    expect(m.anotherField).toBe(42);
  });

  it('manifest with channels array stores channels correctly', async () => {
    createPlugin('chan-plugin', { id: 'chan-p', channels: ['discord', 'telegram'] });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('chan-p')!.manifest.channels).toEqual(['discord', 'telegram']);
  });

  it('manifest with providers array stores providers correctly', async () => {
    createPlugin('prov-plugin', { id: 'prov-p', providers: ['anthropic', 'openai'] });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('prov-p')!.manifest.providers).toEqual(['anthropic', 'openai']);
  });

  it('manifest with skills array stores skills correctly', async () => {
    createPlugin('skill-plugin', { id: 'skill-p', skills: ['summarize', 'translate'] });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('skill-p')!.manifest.skills).toEqual(['summarize', 'translate']);
  });
});

describe('Discovery edge cases', () => {
  it('empty plugin directory returns empty registry', async () => {
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(0);
  });

  it('non-existent directory is skipped gracefully', async () => {
    const registry = await loadPlugins({ dirs: ['/nonexistent/dir/xyz'], cache: false });
    expect(registry.list()).toHaveLength(0);
  });

  it('directory with no manifest files returns empty registry', async () => {
    fs.mkdirSync(path.join(tmpDir, 'no-manifest'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'no-manifest', 'readme.txt'), 'hello');
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(0);
  });

  it('nested directories (not direct children) are not discovered', async () => {
    // Create a nested structure: tmpDir/parent/child/openclaw.plugin.json
    const parentDir = path.join(tmpDir, 'parent');
    const childDir = path.join(parentDir, 'child');
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(path.join(childDir, 'openclaw.plugin.json'), JSON.stringify({ id: 'nested', name: 'Nested' }));
    // parent itself has no manifest
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    // parent is a direct child but has no manifest; child is nested and should not be found
    expect(registry.get('nested')).toBeUndefined();
  });

  it('directory with both openclaw.plugin.json AND leanclaw.plugin.json — openclaw wins', async () => {
    const pluginDir = path.join(tmpDir, 'dual-manifest');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'openclaw.plugin.json'), JSON.stringify({ id: 'openclaw-ver', name: 'OpenClaw Version' }));
    fs.writeFileSync(path.join(pluginDir, 'leanclaw.plugin.json'), JSON.stringify({ id: 'leanclaw-ver', name: 'LeanClaw Version' }));
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('openclaw-ver')).toBeDefined();
    expect(registry.get('openclaw-ver')!.name).toBe('OpenClaw Version');
    expect(registry.get('leanclaw-ver')).toBeUndefined();
  });
});

describe('Registry caching', () => {
  it('second call with same dirs returns cached registry', async () => {
    createPlugin('cached-plugin', { id: 'cached', name: 'Cached' });
    const r1 = await loadPlugins({ dirs: [tmpDir], cache: true });
    const r2 = await loadPlugins({ dirs: [tmpDir], cache: true });
    // Same reference means it was cached
    expect(r1).toBe(r2);
  });

  it('cache=false bypasses cache', async () => {
    createPlugin('no-cache-plugin', { id: 'no-cache', name: 'NoCache' });
    const r1 = await loadPlugins({ dirs: [tmpDir], cache: false });
    const r2 = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(r1).not.toBe(r2);
  });

  it('different dirs get different cached registries', async () => {
    createPlugin('diff-dir-plugin', { id: 'diff-dir', name: 'DiffDir' });
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test2-'));
    try {
      const r1 = await loadPlugins({ dirs: [tmpDir], cache: true });
      const r2 = await loadPlugins({ dirs: [tmpDir2], cache: true });
      expect(r1).not.toBe(r2);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});

describe('jiti TypeScript loader', () => {
  it('loads .ts plugin file via jiti', async () => {
    const fixtureDir = path.resolve(__dirname, '../../e2e/fixtures/plugins');
    const registry = await loadPlugins({ dirs: [fixtureDir], cache: false });
    const tsPlugin = registry.get('ts-register-plugin');
    expect(tsPlugin).toBeDefined();
    expect(tsPlugin!.status).toBe('loaded');
    expect(tsPlugin!.runtime).toBeDefined();
  });

  it('calls register(api) and registers tools', async () => {
    const fixtureDir = path.resolve(__dirname, '../../e2e/fixtures/plugins');
    const registry = await loadPlugins({ dirs: [fixtureDir], cache: false });
    const tools = registry.getTools();
    const testTool = tools.find((t) => t.name === 'test_tool');
    expect(testTool).toBeDefined();
    expect(testTool!.pluginId).toBe('ts-register-plugin');
    expect(testTool!.description).toBe('A test tool for compatibility testing');
  });

  it('plugin register() error does not crash other plugins', async () => {
    const fixtureDir = path.resolve(__dirname, '../../e2e/fixtures/plugins');
    const registry = await loadPlugins({ dirs: [fixtureDir], cache: false });
    // bad-register-plugin throws in register() but should still be loaded
    const bad = registry.get('bad-register-plugin');
    expect(bad).toBeDefined();
    expect(bad!.status).toBe('loaded');
    // ts-register-plugin should still have loaded and registered its tool
    const tools = registry.getTools();
    expect(tools.find((t) => t.name === 'test_tool')).toBeDefined();
    // Other non-TS plugins should also still be present
    expect(registry.get('echo-plugin')).toBeDefined();
  });
});

describe('Error handling', () => {
  it('invalid JSON manifest logs warning and continues loading other plugins', async () => {
    const badDir = path.join(tmpDir, 'bad-json');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'openclaw.plugin.json'), '{ not valid json!!!');
    createPlugin('good-plugin', { id: 'good', name: 'Good' });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('good')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('manifest with missing required id field is rejected gracefully', async () => {
    createPlugin('no-id', { name: 'No ID Plugin', version: '1.0.0' });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(0);
  });

  it('manifest with empty id string is rejected', async () => {
    createPlugin('empty-id', { id: '', name: 'Empty ID' });
    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.list()).toHaveLength(0);
  });

  it('directory with unreadable manifest is skipped', async () => {
    // Create a plugin dir where manifest is a directory instead of a file
    const pluginDir = path.join(tmpDir, 'unreadable');
    fs.mkdirSync(path.join(pluginDir, 'openclaw.plugin.json'), { recursive: true });
    createPlugin('ok-plugin', { id: 'ok', name: 'OK' });

    const registry = await loadPlugins({ dirs: [tmpDir], cache: false });
    expect(registry.get('ok')).toBeDefined();
  });
});
