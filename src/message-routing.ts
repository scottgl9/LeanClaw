/**
 * Keyword-based message routing for pre-turn model selection.
 *
 * Routes incoming messages to different LLM models based on keyword/pattern
 * matching before any LLM call. Zero cost — pure string matching, first-match-wins.
 *
 * Config example (leanclaw.json):
 *
 *   "messageRouting": {
 *     "rules": [
 *       { "match": ["code review", "PR", "diff", "refactor"], "model": "github-copilot/claude-sonnet-4.6" },
 *       { "match": ["research", "search", "find"],            "model": "gemini-3-flash" }
 *     ],
 *     "default": "qwen35"
 *   }
 */

export type MessageRoutingRule = {
  /** Keywords to match (case-insensitive substring match). First rule with any match wins. */
  match: string[];
  /** Model identifier to use when this rule matches. */
  model: string;
};

export type MessageRoutingConfig = {
  rules: MessageRoutingRule[];
  /** Fallback model when no rule matches. If omitted, the primary configured model is used. */
  default?: string;
};

/**
 * Resolves the model to use based on keyword matching in the message text.
 *
 * @param config  - The routing config (from leanclaw.json `messageRouting` field).
 * @param messageText - The incoming message text to match against.
 * @returns The matched model string, or `undefined` if no rule matches and no default is set.
 */
export function resolveMessageRoutingModel(
  config: MessageRoutingConfig | undefined,
  messageText: string,
): string | undefined {
  if (!config?.rules?.length) return undefined;
  const text = messageText.toLowerCase();
  for (const rule of config.rules) {
    if (rule.match.some((kw) => text.includes(kw.toLowerCase()))) {
      return rule.model?.trim() || undefined;
    }
  }
  return config.default?.trim() || undefined;
}
