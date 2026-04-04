import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerHook, executeHooks, getHooks, clearHooks } from './registry.js';

beforeEach(() => {
  clearHooks();
});

describe('registerHook', () => {
  it('registers a hook for an event', () => {
    const handler = vi.fn();
    registerHook('test-plugin', 'before_agent_run', handler);
    const hooks = getHooks('before_agent_run');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].pluginId).toBe('test-plugin');
    expect(hooks[0].event).toBe('before_agent_run');
  });

  it('allows multiple hooks for the same event', () => {
    registerHook('plugin-a', 'after_message', vi.fn());
    registerHook('plugin-b', 'after_message', vi.fn());
    expect(getHooks('after_message')).toHaveLength(2);
  });

  it('allows hooks for different events', () => {
    registerHook('plugin-a', 'before_agent_run', vi.fn());
    registerHook('plugin-a', 'after_agent_run', vi.fn());
    expect(getHooks('before_agent_run')).toHaveLength(1);
    expect(getHooks('after_agent_run')).toHaveLength(1);
  });
});

describe('executeHooks', () => {
  it('calls all handlers for an event', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    registerHook('p1', 'before_message', handler1);
    registerHook('p2', 'before_message', handler2);

    await executeHooks('before_message', { chatJid: 'test' });

    expect(handler1).toHaveBeenCalledWith({ chatJid: 'test' });
    expect(handler2).toHaveBeenCalledWith({ chatJid: 'test' });
  });

  it('does nothing for events with no hooks', async () => {
    await executeHooks('nonexistent_event');
    // No error thrown
  });

  it('continues executing after a handler throws', async () => {
    const handler1 = vi.fn().mockRejectedValue(new Error('boom'));
    const handler2 = vi.fn();
    registerHook('p1', 'after_agent_run', handler1);
    registerHook('p2', 'after_agent_run', handler2);

    await executeHooks('after_agent_run');

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('handles async handlers', async () => {
    const order: number[] = [];
    registerHook('p1', 'session_start', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(1);
    });
    registerHook('p2', 'session_start', async () => {
      order.push(2);
    });

    await executeHooks('session_start');
    expect(order).toEqual([1, 2]);
  });
});

describe('getHooks', () => {
  it('returns empty array for unknown event', () => {
    expect(getHooks('unknown')).toEqual([]);
  });

  it('returns all hooks when no event specified', () => {
    registerHook('p1', 'before_agent_run', vi.fn());
    registerHook('p2', 'after_message', vi.fn());
    expect(getHooks()).toHaveLength(2);
  });
});

describe('clearHooks', () => {
  it('clears all hooks', () => {
    registerHook('p1', 'before_agent_run', vi.fn());
    registerHook('p2', 'after_message', vi.fn());
    clearHooks();
    expect(getHooks()).toHaveLength(0);
  });

  it('clears hooks for a specific plugin', () => {
    registerHook('p1', 'before_agent_run', vi.fn());
    registerHook('p2', 'before_agent_run', vi.fn());
    registerHook('p1', 'after_message', vi.fn());

    clearHooks('p1');

    expect(getHooks('before_agent_run')).toHaveLength(1);
    expect(getHooks('before_agent_run')[0].pluginId).toBe('p2');
    expect(getHooks('after_message')).toHaveLength(0);
  });
});
