import { getProviderUsage, trackProviderUsage } from '../db.js';
import { logger } from '../logger.js';

export interface BudgetConfig {
  maxTokensPerDay?: number;
  maxTokensPerMonth?: number;
  warnThreshold?: number; // 0-1, default 0.8
}

export class TokenBudgetManager {
  private config: BudgetConfig;

  constructor(config: BudgetConfig = {}) {
    this.config = {
      warnThreshold: 0.8,
      ...config,
    };
  }

  trackUsage(group: string, provider: string, inputTokens: number, outputTokens: number): void {
    trackProviderUsage(group, provider, inputTokens, outputTokens);
  }

  getBudgetRemaining(group: string, period: 'day' | 'month' = 'day'): number | null {
    const maxTokens = period === 'day'
      ? this.config.maxTokensPerDay
      : this.config.maxTokensPerMonth;

    if (!maxTokens) return null; // No budget configured

    const since = period === 'day'
      ? new Date(Date.now() - 86_400_000).toISOString()
      : new Date(Date.now() - 30 * 86_400_000).toISOString();

    const usage = getProviderUsage(group, since);
    const totalTokens = usage.reduce(
      (sum, u) => sum + u.inputTokens + u.outputTokens,
      0,
    );

    return Math.max(0, maxTokens - totalTokens);
  }

  isOverBudget(group: string, period: 'day' | 'month' = 'day'): boolean {
    const remaining = this.getBudgetRemaining(group, period);
    if (remaining === null) return false;
    return remaining <= 0;
  }

  isNearBudget(group: string, period: 'day' | 'month' = 'day'): boolean {
    const maxTokens = period === 'day'
      ? this.config.maxTokensPerDay
      : this.config.maxTokensPerMonth;

    if (!maxTokens) return false;

    const remaining = this.getBudgetRemaining(group, period);
    if (remaining === null) return false;

    const threshold = this.config.warnThreshold || 0.8;
    return remaining <= maxTokens * (1 - threshold);
  }

  checkBudget(group: string, provider: string): 'ok' | 'warn' | 'blocked' {
    if (this.isOverBudget(group, 'day') || this.isOverBudget(group, 'month')) {
      logger.warn({ group, provider }, 'Token budget exceeded');
      return 'blocked';
    }

    if (this.isNearBudget(group, 'day') || this.isNearBudget(group, 'month')) {
      logger.info({ group, provider }, 'Approaching token budget limit');
      return 'warn';
    }

    return 'ok';
  }
}
