import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { compactSession } from './compaction.js';
import { SessionManager } from './session.js';
import * as providerBase from '../providers/base.js';

// Mock the providers/base module
vi.mock('../providers/base.js', () => ({
  getConfiguredProvider: vi.fn(),
  registerProvider: vi.fn(),
  getProvider: vi.fn(),
  listProviders: vi.fn(() => []),
  getProviderContainerEnv: vi.fn(() => ({})),
}));

describe('compactSession', () => {
  const tmpDir = path.join(os.tmpdir(), `compaction-test-${Date.now()}`);
  let sessions: SessionManager;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    sessions = new SessionManager();
    // Override getSessionDir to use tmp
    vi.spyOn(sessions, 'getSessionDir').mockReturnValue(path.join(tmpDir, '.claude'));
    vi.spyOn(sessions, 'ensureSessionDir').mockReturnValue(path.join(tmpDir, '.claude'));
  });

  it('throws when no provider is configured', async () => {
    vi.mocked(providerBase.getConfiguredProvider).mockReturnValue(undefined);
    await expect(compactSession(sessions, { groupFolder: 'test' }))
      .rejects.toThrow('No configured provider');
  });

  it('throws when provider does not support summarize', async () => {
    vi.mocked(providerBase.getConfiguredProvider).mockReturnValue({
      id: 'test',
      name: 'Test',
      countTokens: (t: string) => t.length,
      isConfigured: () => true,
    } as any);
    await expect(compactSession(sessions, { groupFolder: 'test' }))
      .rejects.toThrow('does not support summarize');
  });

  it('throws when no session history exists', async () => {
    const mockProvider = {
      id: 'test',
      name: 'Test',
      countTokens: (t: string) => Math.ceil(t.length / 4),
      isConfigured: () => true,
      summarize: vi.fn(),
    };
    vi.mocked(providerBase.getConfiguredProvider).mockReturnValue(mockProvider as any);

    await expect(compactSession(sessions, { groupFolder: 'empty' }))
      .rejects.toThrow('No session history');
  });

  it('compacts session history and replaces files', async () => {
    // Create session directory with history
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'transcript.txt'), 'User: Hello\nAssistant: Hi!\nUser: How are you?\nAssistant: Good!');

    const mockProvider = {
      id: 'test',
      name: 'Test',
      countTokens: (t: string) => Math.ceil(t.length / 4),
      isConfigured: () => true,
      summarize: vi.fn().mockResolvedValue('Compacted: User greeted assistant.'),
    };
    vi.mocked(providerBase.getConfiguredProvider).mockReturnValue(mockProvider as any);

    const result = await compactSession(sessions, {
      groupFolder: 'test',
      instructions: 'Keep it short',
    });

    expect(result.groupFolder).toBe('test');
    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.compactedTokens).toBeGreaterThan(0);
    expect(result.compactedTokens).toBeLessThan(result.originalTokens);
    expect(mockProvider.summarize).toHaveBeenCalledWith(
      expect.stringContaining('Hello'),
      'Keep it short',
      undefined,
    );

    // Verify old files replaced and compacted file exists
    const files = fs.readdirSync(claudeDir);
    expect(files).toContain('compacted-summary.txt');
    expect(files).not.toContain('transcript.txt');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});
