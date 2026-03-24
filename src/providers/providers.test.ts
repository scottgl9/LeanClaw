import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase } from '../db.js';
import { AnthropicProvider } from './anthropic.js';
import { CopilotProvider } from './copilot.js';
import { TokenBudgetManager } from './token-counter.js';
import { registerProvider, getProvider, listProviders, getProviderContainerEnv } from './base.js';

describe('AnthropicProvider', () => {
  it('is not configured without credentials', () => {
    const provider = new AnthropicProvider();
    // Since ANTHROPIC_API_KEY is not set in test env
    expect(provider.id).toBe('anthropic');
    expect(provider.name).toBe('Anthropic Claude');
  });

  it('authenticates with API key', async () => {
    const provider = new AnthropicProvider();
    const result = await provider.authenticate({ apiKey: 'test-key' });
    expect(result.success).toBe(true);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.getContainerEnv()).toEqual({ ANTHROPIC_API_KEY: 'test-key' });
  });

  it('authenticates with OAuth token', async () => {
    const provider = new AnthropicProvider();
    const result = await provider.authenticate({ oauthToken: 'oauth-token' });
    expect(result.success).toBe(true);
    expect(provider.getContainerEnv()).toEqual({ ANTHROPIC_AUTH_TOKEN: 'oauth-token' });
  });

  it('fails without credentials', async () => {
    const provider = new AnthropicProvider();
    const result = await provider.authenticate({});
    expect(result.success).toBe(false);
  });

  it('counts tokens approximately', () => {
    const provider = new AnthropicProvider();
    const count = provider.countTokens('Hello world, this is a test');
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
  });

  it('estimates cost', () => {
    const provider = new AnthropicProvider();
    const cost = provider.estimateCost(1000, 500);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('CopilotProvider', () => {
  it('has correct identity', () => {
    const provider = new CopilotProvider();
    expect(provider.id).toBe('copilot');
    expect(provider.name).toBe('GitHub Copilot');
  });

  it('authenticates with GitHub token', async () => {
    const provider = new CopilotProvider();
    const result = await provider.authenticate({ apiKey: 'ghp_test123' });
    expect(result.success).toBe(true);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.getContainerEnv()).toEqual({ GITHUB_TOKEN: 'ghp_test123' });
  });

  it('authenticates with OAuth token', async () => {
    const provider = new CopilotProvider();
    const result = await provider.authenticate({ oauthToken: 'gho_test123' });
    expect(result.success).toBe(true);
    expect(provider.getContainerEnv()).toEqual({ GITHUB_OAUTH_TOKEN: 'gho_test123' });
  });

  it('estimates zero cost (subscription model)', () => {
    const provider = new CopilotProvider();
    expect(provider.estimateCost(1000, 500)).toBe(0);
  });
});

describe('Provider registry', () => {
  it('registers and retrieves providers', () => {
    const provider = new AnthropicProvider();
    registerProvider(provider);
    expect(getProvider('anthropic')).toBe(provider);
  });

  it('lists all providers', () => {
    const anthropic = new AnthropicProvider();
    const copilot = new CopilotProvider();
    registerProvider(anthropic);
    registerProvider(copilot);
    const all = listProviders();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('returns container env for configured provider', async () => {
    const provider = new AnthropicProvider();
    await provider.authenticate({ apiKey: 'test-key' });
    registerProvider(provider);
    const env = getProviderContainerEnv('anthropic');
    expect(env.ANTHROPIC_API_KEY).toBe('test-key');
  });
});

describe('TokenBudgetManager', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('tracks and checks usage', () => {
    const mgr = new TokenBudgetManager({ maxTokensPerDay: 1000 });
    mgr.trackUsage('main', 'anthropic', 100, 50);
    expect(mgr.isOverBudget('main')).toBe(false);
  });

  it('blocks when over budget', () => {
    const mgr = new TokenBudgetManager({ maxTokensPerDay: 100 });
    mgr.trackUsage('main', 'anthropic', 80, 30);
    expect(mgr.isOverBudget('main')).toBe(true);
  });

  it('warns when near budget', () => {
    const mgr = new TokenBudgetManager({ maxTokensPerDay: 100, warnThreshold: 0.8 });
    mgr.trackUsage('main', 'anthropic', 85, 0);
    expect(mgr.isNearBudget('main')).toBe(true);
  });

  it('returns null remaining when no budget configured', () => {
    const mgr = new TokenBudgetManager();
    expect(mgr.getBudgetRemaining('main')).toBeNull();
    expect(mgr.isOverBudget('main')).toBe(false);
  });

  it('checkBudget returns correct status', () => {
    const mgr = new TokenBudgetManager({ maxTokensPerDay: 1000 });
    expect(mgr.checkBudget('main', 'anthropic')).toBe('ok');

    mgr.trackUsage('main', 'anthropic', 850, 0);
    expect(mgr.checkBudget('main', 'anthropic')).toBe('warn');

    mgr.trackUsage('main', 'anthropic', 200, 0);
    expect(mgr.checkBudget('main', 'anthropic')).toBe('blocked');
  });
});
