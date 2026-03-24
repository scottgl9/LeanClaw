import { ANTHROPIC_API_KEY } from '../config.js';
import { logger } from '../logger.js';
import type { AuthResult, LLMProvider, ProviderAuthConfig } from '../types.js';

// Approximate token counts per model (cost per 1M tokens in USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.80, output: 4.0 },
};

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic Claude';

  private apiKey: string | undefined;
  private oauthToken: string | undefined;
  private model = 'claude-sonnet-4-6';

  constructor() {
    this.apiKey = ANTHROPIC_API_KEY;
  }

  async authenticate(config: ProviderAuthConfig): Promise<AuthResult> {
    if (config.apiKey) {
      this.apiKey = config.apiKey;
      logger.info({ provider: this.id }, 'Authenticated with API key');
      return { success: true };
    }

    if (config.oauthToken) {
      this.oauthToken = config.oauthToken;
      logger.info({ provider: this.id }, 'Authenticated with OAuth token');
      return { success: true };
    }

    return { success: false, error: 'No API key or OAuth token provided' };
  }

  countTokens(text: string): number {
    // Approximate: ~4 chars per token for English text
    return Math.ceil(text.length / 4);
  }

  getContainerEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.apiKey) {
      env.ANTHROPIC_API_KEY = this.apiKey;
    }
    if (this.oauthToken) {
      env.ANTHROPIC_AUTH_TOKEN = this.oauthToken;
    }
    return env;
  }

  estimateCost(inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[this.model] || MODEL_PRICING['claude-sonnet-4-6'];
    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }

  isConfigured(): boolean {
    return !!(this.apiKey || this.oauthToken);
  }

  setModel(model: string): void {
    this.model = model;
  }
}
