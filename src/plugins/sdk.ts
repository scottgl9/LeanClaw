/**
 * Plugin SDK re-exports for external plugin authors.
 * Provides the minimal API surface that plugins need.
 */
export type {
  Channel,
  PluginManifest,
  PluginRecord,
  ContainerConfig,
  AdditionalMount,
  ScheduledTask,
  NewMessage,
  HealthStatus,
  AuditEntry,
} from '../types.js';

export { PluginRegistry, getActiveRegistry } from './registry.js';
export { loadPlugins, getPlugin, listPlugins } from './loader.js';
export { createPluginApi } from './plugin-api.js';
export type { PluginApi, RegisteredTool } from './plugin-api.js';
