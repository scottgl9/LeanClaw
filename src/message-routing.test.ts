import { describe, it, expect } from 'vitest';
import { resolveMessageRoutingModel, type MessageRoutingConfig } from './message-routing.js';

const config: MessageRoutingConfig = {
  rules: [
    { match: ['code review', 'PR', 'diff', 'refactor'], model: 'github-copilot/claude-sonnet-4.6' },
    { match: ['research', 'search', 'find'], model: 'gemini-3-flash' },
  ],
  default: 'qwen35',
};

describe('resolveMessageRoutingModel', () => {
  it('returns undefined for undefined config', () => {
    expect(resolveMessageRoutingModel(undefined, 'hello')).toBeUndefined();
  });

  it('returns undefined for empty rules and no default', () => {
    expect(resolveMessageRoutingModel({ rules: [] }, 'hello')).toBeUndefined();
  });

  it('matches first rule on keyword hit', () => {
    expect(resolveMessageRoutingModel(config, 'Can you do a code review of this?')).toBe(
      'github-copilot/claude-sonnet-4.6',
    );
  });

  it('is case-insensitive', () => {
    expect(resolveMessageRoutingModel(config, 'Review this PR please')).toBe(
      'github-copilot/claude-sonnet-4.6',
    );
  });

  it('matches second rule', () => {
    expect(resolveMessageRoutingModel(config, 'Can you research this topic?')).toBe('gemini-3-flash');
  });

  it('uses default when no rule matches', () => {
    expect(resolveMessageRoutingModel(config, 'What is 2 + 2?')).toBe('qwen35');
  });

  it('returns undefined when no rule matches and no default', () => {
    const cfg: MessageRoutingConfig = {
      rules: [{ match: ['debug'], model: 'some-model' }],
    };
    expect(resolveMessageRoutingModel(cfg, 'hello there')).toBeUndefined();
  });

  it('first-match-wins: earlier rule takes priority', () => {
    // "diff" matches rule 1; "search" matches rule 2 — rule 1 wins
    expect(resolveMessageRoutingModel(config, 'search the diff for issues')).toBe(
      'github-copilot/claude-sonnet-4.6',
    );
  });
});
