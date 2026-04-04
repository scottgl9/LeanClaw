import { ANTHROPIC_API_KEY, COMPACTION_MODEL } from '../config.js';
import { logger } from '../logger.js';
import type { AuthResult, LLMProvider, ProviderAuthConfig } from '../types.js';

// Approximate token counts per model (cost per 1M tokens in USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.80, output: 4.0 },
};

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
};

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic Claude';
  contextWindowSize = 200_000;

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
    this.contextWindowSize = MODEL_CONTEXT_WINDOWS[model] || 200_000;
  }

  async summarize(text: string, instructions?: string, model?: string): Promise<string> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error('Anthropic API key not configured for compaction');

    const compactModel = model || COMPACTION_MODEL || 'claude-haiku-4-5';

    const systemPrompt = [
      'You are a conversation compactor. Summarize the following conversation history into a concise but complete summary.',
      'Preserve all important context, decisions, facts, and action items.',
      'Remove redundant exchanges, greetings, and filler.',
      'Output only the summary, no preamble.',
      instructions ? `Additional instructions: ${instructions}` : '',
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: compactModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const textBlock = data.content?.find((b) => b.type === 'text');
    if (!textBlock?.text) throw new Error('No text in compaction response');

    logger.info({ model: compactModel, inputLen: text.length, outputLen: textBlock.text.length }, 'Session compacted');
    return textBlock.text;
  }
}
