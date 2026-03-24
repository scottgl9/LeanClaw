import { GITHUB_TOKEN } from '../config.js';
import { logger } from '../logger.js';
import type { AuthResult, LLMProvider, ProviderAuthConfig } from '../types.js';

export class CopilotProvider implements LLMProvider {
  id = 'copilot';
  name = 'GitHub Copilot';

  private token: string | undefined;
  private oauthToken: string | undefined;

  constructor() {
    this.token = GITHUB_TOKEN;
  }

  async authenticate(config: ProviderAuthConfig): Promise<AuthResult> {
    if (config.apiKey) {
      this.token = config.apiKey;
      logger.info({ provider: this.id }, 'Authenticated with GitHub token');
      return { success: true };
    }

    if (config.oauthToken) {
      this.oauthToken = config.oauthToken;
      logger.info({ provider: this.id }, 'Authenticated with OAuth token');
      return { success: true };
    }

    return { success: false, error: 'No GitHub token or OAuth token provided' };
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  getContainerEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.token) {
      env.GITHUB_TOKEN = this.token;
    }
    if (this.oauthToken) {
      env.GITHUB_OAUTH_TOKEN = this.oauthToken;
    }
    return env;
  }

  estimateCost(_inputTokens: number, _outputTokens: number): number {
    // GitHub Copilot pricing is subscription-based, not per-token
    return 0;
  }

  isConfigured(): boolean {
    return !!(this.token || this.oauthToken);
  }
}
