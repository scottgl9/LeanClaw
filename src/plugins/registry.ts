import type { PluginRecord } from '../types.js';
import type { RegisteredTool } from './plugin-api.js';
import { logger } from '../logger.js';

export interface PluginHttpRoute {
  method: string;
  path: string;
  handler: (req: unknown, res: unknown) => void | Promise<void>;
  pluginId: string;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginRecord>();
  private allTools: RegisteredTool[] = [];
  private httpRoutes: PluginHttpRoute[] = [];

  register(plugin: PluginRecord): void {
    this.plugins.set(plugin.id, plugin);
    logger.info({ pluginId: plugin.id, version: plugin.version }, 'Plugin registered');
  }

  get(id: string): PluginRecord | undefined {
    return this.plugins.get(id);
  }

  list(): PluginRecord[] {
    return Array.from(this.plugins.values());
  }

  unload(id: string): boolean {
    const existed = this.plugins.delete(id);
    if (existed) {
      this.allTools = this.allTools.filter((t) => t.pluginId !== id);
      this.httpRoutes = this.httpRoutes.filter((r) => r.pluginId !== id);
      logger.info({ pluginId: id }, 'Plugin unloaded');
    }
    return existed;
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  clear(): void {
    this.plugins.clear();
    this.allTools = [];
    this.httpRoutes = [];
  }

  registerTool(tool: RegisteredTool): void {
    this.allTools.push(tool);
    logger.info({ pluginId: tool.pluginId, tool: tool.name }, 'Tool registered');
  }

  getTools(): RegisteredTool[] {
    return this.allTools;
  }

  registerHttpRoute(route: PluginHttpRoute): void {
    this.httpRoutes.push(route);
    logger.info({ pluginId: route.pluginId, method: route.method, path: route.path }, 'HTTP route registered');
  }

  getHttpRoutes(): PluginHttpRoute[] {
    return this.httpRoutes;
  }
}

let activeRegistry: PluginRegistry | null = null;

export function getActiveRegistry(): PluginRegistry {
  if (!activeRegistry) {
    activeRegistry = new PluginRegistry();
  }
  return activeRegistry;
}

export function setActiveRegistry(registry: PluginRegistry): void {
  activeRegistry = registry;
}
