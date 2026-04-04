/**
 * Session compaction — summarizes conversation history to free context window space.
 * Uses the configured LLM provider's summarize() method for direct API calls.
 */
import { logger } from '../logger.js';
import { getConfiguredProvider } from '../providers/base.js';
import { SessionManager } from './session.js';
import type { CompactionResult } from '../types.js';

export interface CompactSessionOpts {
  groupFolder: string;
  instructions?: string;
  model?: string;
  providerId?: string;
}

export async function compactSession(
  sessions: SessionManager,
  opts: CompactSessionOpts,
): Promise<CompactionResult> {
  const { groupFolder, instructions, model, providerId } = opts;

  const provider = getConfiguredProvider(providerId);
  if (!provider) {
    throw new Error(`No configured provider available for compaction`);
  }

  if (typeof provider.summarize !== 'function') {
    throw new Error(`Provider "${provider.id}" does not support summarize()`);
  }

  // Read current session history
  const history = sessions.getSessionHistory(groupFolder);
  if (!history || history.trim().length === 0) {
    throw new Error(`No session history found for group "${groupFolder}"`);
  }

  const originalTokens = provider.countTokens(history);

  // Call provider to summarize
  const compacted = await provider.summarize(history, instructions, model);
  const compactedTokens = provider.countTokens(compacted);

  // Replace session history with compacted version
  sessions.replaceSessionHistory(groupFolder, compacted);

  const result: CompactionResult = {
    groupFolder,
    originalTokens,
    compactedTokens,
    model: model || 'default',
    compactedAt: new Date().toISOString(),
  };

  logger.info({
    groupFolder,
    originalTokens,
    compactedTokens,
    reduction: `${Math.round((1 - compactedTokens / originalTokens) * 100)}%`,
  }, 'Session compacted');

  return result;
}
