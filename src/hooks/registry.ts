/**
 * Hook event registry for plugin lifecycle hooks.
 * Plugins register handlers for lifecycle events; the runtime fires them at appropriate points.
 */
import { logger } from '../logger.js';

export type HookHandler = (context: Record<string, unknown>) => void | Promise<void>;

export interface RegisteredHook {
  pluginId: string;
  event: string;
  handler: HookHandler;
}

/** Known hook event names */
export const HOOK_EVENTS = [
  'before_agent_run',
  'after_agent_run',
  'before_message',
  'after_message',
  'before_compaction',
  'after_compaction',
  'on_gateway_startup',
  'on_gateway_shutdown',
  'session_start',
  'session_end',
  'pre_tool_use',
  'post_tool_use',
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

const hooks = new Map<string, RegisteredHook[]>();

export function registerHook(pluginId: string, event: string, handler: HookHandler): void {
  const existing = hooks.get(event) || [];
  existing.push({ pluginId, event, handler });
  hooks.set(event, existing);
  logger.debug({ pluginId, event }, 'Hook registered');
}

export async function executeHooks(event: string, context: Record<string, unknown> = {}): Promise<void> {
  const handlers = hooks.get(event);
  if (!handlers || handlers.length === 0) return;

  for (const hook of handlers) {
    try {
      await hook.handler(context);
    } catch (err) {
      logger.error({ pluginId: hook.pluginId, event, err }, 'Hook execution failed');
    }
  }
}

export function getHooks(event?: string): RegisteredHook[] {
  if (event) return hooks.get(event) || [];
  const all: RegisteredHook[] = [];
  for (const list of hooks.values()) {
    all.push(...list);
  }
  return all;
}

export function clearHooks(pluginId?: string): void {
  if (!pluginId) {
    hooks.clear();
    return;
  }
  for (const [event, list] of hooks.entries()) {
    const filtered = list.filter((h) => h.pluginId !== pluginId);
    if (filtered.length === 0) {
      hooks.delete(event);
    } else {
      hooks.set(event, filtered);
    }
  }
}
