import type { PluginRecord } from '../types.js';
import type { RegisteredTool } from './plugin-api.js';
import { logger } from '../logger.js';

export class PluginRegistry {
  private plugins = new Map<string, PluginRecord>();
  private allTools: RegisteredTool[] = [];

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
  }

  registerTool(tool: RegisteredTool): void {
    this.allTools.push(tool);
    logger.info({ pluginId: tool.pluginId, tool: tool.name }, 'Tool registered');
  }

  getTools(): RegisteredTool[] {
    return this.allTools;
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
