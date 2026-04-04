/**
 * Webhook Hook Executor
 * Sends HTTP POST to configured URLs at lifecycle events.
 */
import { logger } from '../logger.js';

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export async function executeWebhook(
  config: WebhookConfig,
  event: string,
  context: Record<string, unknown>,
): Promise<boolean> {
  const { url, headers = {}, timeout = 10000 } = config;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ event, context, timestamp: new Date().toISOString() }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      logger.warn({ url, event, status: response.status }, 'Webhook returned non-OK status');
      return false;
    }

    logger.debug({ url, event }, 'Webhook executed successfully');
    return true;
  } catch (err) {
    logger.error({ url, event, err }, 'Webhook execution failed');
    return false;
  }
}
