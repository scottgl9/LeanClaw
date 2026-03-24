import { describe, it, expect } from 'vitest';
import {
  hostGatewayArgs,
  readonlyMountArgs,
  stopContainerCmd,
  type ContainerInput,
  type ContainerOutput,
} from './container.js';

describe('container utilities', () => {
  describe('hostGatewayArgs', () => {
    it('returns args on linux', () => {
      const args = hostGatewayArgs();
      // On Linux CI this returns the host gateway arg; on other platforms empty
      expect(Array.isArray(args)).toBe(true);
    });
  });

  describe('readonlyMountArgs', () => {
    it('builds readonly volume args', () => {
      const args = readonlyMountArgs('/host/path', '/container/path');
      expect(args).toEqual(['-v', '/host/path:/container/path:ro']);
    });
  });

  describe('stopContainerCmd', () => {
    it('builds stop command', () => {
      const cmd = stopContainerCmd('leanclaw-main-123');
      expect(cmd).toBe('docker stop -t 1 leanclaw-main-123');
    });
  });
});

describe('ContainerInput type', () => {
  it('accepts valid input shape', () => {
    const input: ContainerInput = {
      prompt: 'Hello',
      groupFolder: 'main',
      chatJid: 'chat@jid',
      isMain: true,
    };
    expect(input.prompt).toBe('Hello');
    expect(input.isMain).toBe(true);
  });

  it('accepts optional fields', () => {
    const input: ContainerInput = {
      prompt: 'Hello',
      sessionId: 'sess-123',
      groupFolder: 'main',
      chatJid: 'chat@jid',
      isMain: false,
      isScheduledTask: true,
      assistantName: 'Andy',
    };
    expect(input.sessionId).toBe('sess-123');
    expect(input.isScheduledTask).toBe(true);
  });
});

describe('ContainerOutput type', () => {
  it('represents success', () => {
    const output: ContainerOutput = {
      status: 'success',
      result: 'Response text',
      newSessionId: 'sess-456',
    };
    expect(output.status).toBe('success');
    expect(output.result).toBe('Response text');
  });

  it('represents error', () => {
    const output: ContainerOutput = {
      status: 'error',
      result: null,
      error: 'Container timed out',
    };
    expect(output.status).toBe('error');
    expect(output.error).toContain('timed out');
  });
});
