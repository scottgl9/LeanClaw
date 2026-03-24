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
