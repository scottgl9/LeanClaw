import type { AuthResult, LLMProvider, ProviderAuthConfig, ProviderConfig } from '../types.js';
import { DEFAULT_PROVIDER } from '../config.js';
import { logger } from '../logger.js';

// Provider registry
const providers = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.id, provider);
  logger.debug({ providerId: provider.id }, 'Provider registered');
}

export function getProvider(id?: string): LLMProvider | undefined {
  const providerId = id || DEFAULT_PROVIDER;
  return providers.get(providerId);
}

export function getConfiguredProvider(id?: string): LLMProvider | undefined {
  const provider = getProvider(id);
  if (provider && provider.isConfigured()) return provider;
  return undefined;
}

export function listProviders(): LLMProvider[] {
  return Array.from(providers.values());
}

export function getProviderContainerEnv(id?: string): Record<string, string> {
  const provider = getConfiguredProvider(id);
  if (!provider) return {};
  return provider.getContainerEnv();
}
