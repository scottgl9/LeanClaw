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

  // --- Extended edge case tests ---

  it('empty message text returns default', () => {
    expect(resolveMessageRoutingModel(config, '')).toBe('qwen35');
  });

  it('empty message text returns undefined when no default', () => {
    const cfg: MessageRoutingConfig = { rules: [{ match: ['debug'], model: 'some-model' }] };
    expect(resolveMessageRoutingModel(cfg, '')).toBeUndefined();
  });

  it('multi-keyword rule — partial match (any one keyword triggers)', () => {
    // Only 'refactor' from the first rule — should still match
    expect(resolveMessageRoutingModel(config, 'please refactor this function')).toBe(
      'github-copilot/claude-sonnet-4.6',
    );
  });

  it('case-insensitive: all-caps keyword matches lowercase rule', () => {
    expect(resolveMessageRoutingModel(config, 'Can you do a CODE REVIEW?')).toBe(
      'github-copilot/claude-sonnet-4.6',
    );
  });

  it('whitespace in keyword — keyword with leading/trailing spaces still matches', () => {
    const cfg: MessageRoutingConfig = {
      rules: [{ match: ['  code review  '], model: 'github-copilot/claude-sonnet-4.6' }],
    };
    expect(resolveMessageRoutingModel(cfg, 'Can you do a code review of this?')).toBe(
      'github-copilot/claude-sonnet-4.6',
    );
  });

  it('special characters in message do not crash', () => {
    expect(() =>
      resolveMessageRoutingModel(config, 'Hello! @user #tag $var %percent ^caret &amp; *star (paren) [bracket] {brace}'),
    ).not.toThrow();
  });

  it('special characters in message return default when no match', () => {
    expect(resolveMessageRoutingModel(config, '!@#$%^&*()')).toBe('qwen35');
  });

  it('model alias with no provider prefix is returned as-is', () => {
    const cfg: MessageRoutingConfig = {
      rules: [{ match: ['summarize'], model: 'sonnet' }],
    };
    expect(resolveMessageRoutingModel(cfg, 'please summarize this')).toBe('sonnet');
  });

  it('rule with empty match array is skipped without crashing', () => {
    const cfg: MessageRoutingConfig = {
      rules: [
        { match: [], model: 'should-not-match' },
        { match: ['hello'], model: 'correct-model' },
      ],
    };
    expect(resolveMessageRoutingModel(cfg, 'hello world')).toBe('correct-model');
  });

  it('null message returns default', () => {
    expect(resolveMessageRoutingModel(config, null as unknown as string)).toBe('qwen35');
  });

  it('undefined message returns default', () => {
    expect(resolveMessageRoutingModel(config, undefined as unknown as string)).toBe('qwen35');
  });

  it('null message returns undefined when no default', () => {
    const cfg: MessageRoutingConfig = { rules: [{ match: ['debug'], model: 'some-model' }] };
    expect(resolveMessageRoutingModel(cfg, null as unknown as string)).toBeUndefined();
  });

  it('multiple rules matching — first rule wins', () => {
    // 'find' matches rule 2, 'PR' matches rule 1 — rule 1 appears first
    const cfg: MessageRoutingConfig = {
      rules: [
        { match: ['PR'], model: 'rule-one' },
        { match: ['find'], model: 'rule-two' },
      ],
    };
    expect(resolveMessageRoutingModel(cfg, 'find the PR that broke this')).toBe('rule-one');
  });

  it('keyword buried in long message still matches', () => {
    const longMessage =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
      'Now please do a code review of the attached snippet. ' +
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.';
    expect(resolveMessageRoutingModel(config, longMessage)).toBe('github-copilot/claude-sonnet-4.6');
  });
});
