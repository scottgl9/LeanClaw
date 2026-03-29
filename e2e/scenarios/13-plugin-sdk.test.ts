/**
 * Scenario 13: Plugin SDK — jiti TypeScript loader + register(api) wiring
 * Verifies that .ts plugins load via jiti, register tools via the SDK,
 * and tools appear in tools.catalog via WebSocket.
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPlugins } from '../../src/plugins/loader.js';
import { startGatewayServer, type GatewayServer } from '../../src/gateway/server.js';
import { openClawConnect, call } from '../helpers/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'plugins');

let server: GatewayServer | null = null;
let testPort = 32500;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  testPort++;
});

describe('Scenario 13: Plugin SDK', () => {
  // 13.1 Load ts-register-plugin via jiti and register tools
  it('13.1 tools.catalog returns tools registered by .ts plugins', async () => {
    // Load plugins (including ts-register-plugin)
    const registry = await loadPlugins({ dirs: [FIXTURES_DIR], cache: false });
    const tools = registry.getTools();

    expect(tools.length).toBeGreaterThanOrEqual(1);
    const testTool = tools.find((t) => t.name === 'test_tool');
    expect(testTool).toBeDefined();
    expect(testTool!.pluginId).toBe('ts-register-plugin');

    // Start gateway and wire plugin tools
    server = await startGatewayServer(testPort);
    server.setPluginTools(tools.map((t) => ({ name: t.name, description: t.description, pluginId: t.pluginId })));

    // Connect as OpenClaw client
    const { ws } = await openClawConnect(testPort);
    try {
      const res = await call(ws, 'tools.catalog');
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.payload)).toBe(true);
      const catalog = res.payload as Array<{ name: string; description: string; pluginId: string }>;
      const found = catalog.find((t) => t.name === 'test_tool');
      expect(found).toBeDefined();
      expect(found!.description).toBe('A test tool for compatibility testing');
      expect(found!.pluginId).toBe('ts-register-plugin');
    } finally {
      ws.close();
    }
  });

  // 13.2 tools.catalog is empty when no plugins register tools
  it('13.2 tools.catalog returns empty array with no plugin tools', async () => {
    server = await startGatewayServer(testPort);
    // Don't call setPluginTools — default is empty

    const { ws } = await openClawConnect(testPort);
    try {
      const res = await call(ws, 'tools.catalog');
      expect(res.ok).toBe(true);
      expect(Array.isArray(res.payload)).toBe(true);
      expect(res.payload).toHaveLength(0);
    } finally {
      ws.close();
    }
  });

  // 13.3 Plugin with throwing register() doesn't prevent other plugins from loading
  it('13.3 bad register() does not block other plugin tools', async () => {
    const registry = await loadPlugins({ dirs: [FIXTURES_DIR], cache: false });

    // bad-register-plugin should be loaded (status not error from register failure)
    const bad = registry.get('bad-register-plugin');
    expect(bad).toBeDefined();
    expect(bad!.status).toBe('loaded');

    // test_tool from ts-register-plugin should still be registered
    const tools = registry.getTools();
    expect(tools.find((t) => t.name === 'test_tool')).toBeDefined();
  });
});
