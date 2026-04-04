import { logger } from '../logger.js';
import type { AuthResult, LLMProvider, ProviderAuthConfig } from '../types.js';

export interface OpenAICompatibleProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  defaultContextWindow?: number;
}

interface OpenAIModel {
  id: string;
  contextWindow?: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  id: string;
  name: string;
  contextWindowSize: number;

  private baseUrl: string;
  private apiKey: string | undefined;
  private model: string;
  private discoveredModels: OpenAIModel[] | null = null;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl?.replace(/\/+$/, '') || '';
    this.apiKey = config.apiKey;
    this.model = config.defaultModel || '';
    this.contextWindowSize = config.defaultContextWindow || 8192;
  }

  async authenticate(config: ProviderAuthConfig): Promise<AuthResult> {
    if (config.apiKey) {
      this.apiKey = config.apiKey;
      logger.info({ provider: this.id }, 'Authenticated with API key');
      return { success: true };
    }
    return { success: false, error: 'No API key provided' };
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getContainerEnv(): Record<string, string> {
    const prefix = this.id.toUpperCase();
    const env: Record<string, string> = {};
    if (this.baseUrl) {
      env[`${prefix}_BASE_URL`] = this.baseUrl;
    }
    if (this.apiKey) {
      env[`${prefix}_API_KEY`] = this.apiKey;
    }
    return env;
  }

  estimateCost(_inputTokens: number, _outputTokens: number): number {
    return 0;
  }

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Discover available models from the server's /v1/models endpoint.
   */
  async discoverModels(): Promise<OpenAIModel[]> {
    if (!this.baseUrl) return [];

    try {
      // Ollama uses /v1/models, vLLM/SGLang use /v1/models too
      const url = `${this.baseUrl}/v1/models`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.debug({ provider: this.id, status: response.status }, 'Model discovery failed');
        return [];
      }

      const data = await response.json() as { data?: Array<{ id: string }> };
      if (!data.data || !Array.isArray(data.data)) return [];

      this.discoveredModels = data.data.map((m) => ({ id: m.id }));
      logger.info({ provider: this.id, modelCount: this.discoveredModels.length }, 'Models discovered');
      return this.discoveredModels;
    } catch (err) {
      logger.debug({ provider: this.id, err }, 'Model discovery error (server may be offline)');
      return [];
    }
  }

  /**
   * Return models: configured default + any discovered models.
   */
  listModels(): Array<{ id: string; provider: string; name: string }> {
    const models: Array<{ id: string; provider: string; name: string }> = [];

    if (this.model) {
      models.push({ id: this.model, provider: this.id, name: this.model });
    }

    if (this.discoveredModels) {
      for (const m of this.discoveredModels) {
        if (!models.some((existing) => existing.id === m.id)) {
          models.push({ id: m.id, provider: this.id, name: m.id });
        }
      }
    }

    return models;
  }

  async summarize(text: string, instructions?: string, model?: string): Promise<string> {
    if (!this.baseUrl) throw new Error(`${this.name} base URL not configured for compaction`);

    const useModel = model || this.model;
    if (!useModel) throw new Error(`${this.name} model not configured for compaction`);

    const systemPrompt = [
      'You are a conversation compactor. Summarize the following conversation history into a concise but complete summary.',
      'Preserve all important context, decisions, facts, and action items.',
      'Remove redundant exchanges, greetings, and filler.',
      'Output only the summary, no preamble.',
      instructions ? `Additional instructions: ${instructions}` : '',
    ].filter(Boolean).join('\n');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: useModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`${this.name} API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`No content in ${this.name} compaction response`);

    logger.info({ provider: this.id, model: useModel, inputLen: text.length, outputLen: content.length }, 'Session compacted');
    return content;
  }
}
