import { describe, it, expect, beforeEach } from 'vitest';
import { registerChannel, getChannelFactory, getRegisteredChannelNames, clearChannelRegistry } from './registry.js';

beforeEach(() => {
  clearChannelRegistry();
});

describe('Channel Registry', () => {
  it('registers and retrieves channel factories', () => {
    const factory = () => null;
    registerChannel('test', factory);
    expect(getChannelFactory('test')).toBe(factory);
  });

  it('returns undefined for unregistered channels', () => {
    expect(getChannelFactory('nonexistent')).toBeUndefined();
  });

  it('lists registered channel names', () => {
    registerChannel('telegram', () => null);
    registerChannel('discord', () => null);
    expect(getRegisteredChannelNames()).toEqual(['telegram', 'discord']);
  });

  it('clears registry', () => {
    registerChannel('test', () => null);
    clearChannelRegistry();
    expect(getRegisteredChannelNames()).toEqual([]);
  });
});
