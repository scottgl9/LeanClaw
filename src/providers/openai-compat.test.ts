import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compat.js';

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider({
      id: 'test-llm',
      name: 'Test LLM',
      baseUrl: 'http://127.0.0.1:8000',
      apiKey: 'test-key',
      defaultModel: 'test-model',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('sets id, name, baseUrl', () => {
      expect(provider.id).toBe('test-llm');
      expect(provider.name).toBe('Test LLM');
      expect(provider.getBaseUrl()).toBe('http://127.0.0.1:8000');
    });

    it('strips trailing slashes from baseUrl', () => {
      const p = new OpenAICompatibleProvider({
        id: 'x', name: 'X', baseUrl: 'http://localhost:8000///',
      });
      expect(p.getBaseUrl()).toBe('http://localhost:8000');
    });

    it('uses default context window of 8192', () => {
      expect(provider.contextWindowSize).toBe(8192);
    });

    it('accepts custom context window', () => {
      const p = new OpenAICompatibleProvider({
        id: 'x', name: 'X', baseUrl: 'http://localhost', defaultContextWindow: 32768,
      });
      expect(p.contextWindowSize).toBe(32768);
    });
  });

  describe('isConfigured', () => {
    it('returns true when baseUrl is set', () => {
      expect(provider.isConfigured()).toBe(true);
    });

    it('returns false when baseUrl is empty', () => {
      const p = new OpenAICompatibleProvider({ id: 'x', name: 'X', baseUrl: '' });
      expect(p.isConfigured()).toBe(false);
    });
  });

  describe('authenticate', () => {
    it('stores apiKey', async () => {
      const p = new OpenAICompatibleProvider({ id: 'x', name: 'X', baseUrl: 'http://localhost' });
      const result = await p.authenticate({ apiKey: 'new-key' });
      expect(result.success).toBe(true);
      expect(p.getContainerEnv()['X_API_KEY']).toBe('new-key');
    });

    it('returns error when no key provided', async () => {
      const result = await provider.authenticate({});
      expect(result.success).toBe(false);
    });
  });

  describe('countTokens', () => {
    it('approximates 4 chars per token', () => {
      expect(provider.countTokens('abcdefgh')).toBe(2);
      expect(provider.countTokens('abc')).toBe(1);
      expect(provider.countTokens('')).toBe(0);
    });
  });

  describe('getContainerEnv', () => {
    it('returns uppercased env vars', () => {
      const env = provider.getContainerEnv();
      expect(env['TEST-LLM_BASE_URL']).toBe('http://127.0.0.1:8000');
      expect(env['TEST-LLM_API_KEY']).toBe('test-key');
    });

    it('omits apiKey when not set', () => {
      const p = new OpenAICompatibleProvider({ id: 'vllm', name: 'vLLM', baseUrl: 'http://localhost' });
      const env = p.getContainerEnv();
      expect(env['VLLM_BASE_URL']).toBe('http://localhost');
      expect(env['VLLM_API_KEY']).toBeUndefined();
    });
  });

  describe('estimateCost', () => {
    it('returns 0 for local providers', () => {
      expect(provider.estimateCost(1000, 500)).toBe(0);
    });
  });

  describe('setModel / getModel', () => {
    it('updates the model', () => {
      provider.setModel('llama-3.1-8b');
      expect(provider.getModel()).toBe('llama-3.1-8b');
    });
  });

  describe('listModels', () => {
    it('returns default model when no discovery', () => {
      const models = provider.listModels();
      expect(models).toEqual([
        { id: 'test-model', provider: 'test-llm', name: 'test-model' },
      ]);
    });

    it('returns empty when no model configured and no discovery', () => {
      const p = new OpenAICompatibleProvider({ id: 'x', name: 'X', baseUrl: 'http://localhost' });
      expect(p.listModels()).toEqual([]);
    });
  });

  describe('discoverModels', () => {
    it('parses /v1/models response', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-a' },
            { id: 'model-b' },
          ],
        }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

      const models = await provider.discoverModels();
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('model-a');
      expect(models[1].id).toBe('model-b');

      // After discovery, listModels includes them
      const all = provider.listModels();
      expect(all).toHaveLength(3); // default + 2 discovered
    });

    it('handles connection errors gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const models = await provider.discoverModels();
      expect(models).toEqual([]);
    });

    it('handles non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);
      const models = await provider.discoverModels();
      expect(models).toEqual([]);
    });

    it('handles malformed response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unexpected: 'format' }),
      } as Response);
      const models = await provider.discoverModels();
      expect(models).toEqual([]);
    });

    it('returns empty when baseUrl not set', async () => {
      const p = new OpenAICompatibleProvider({ id: 'x', name: 'X', baseUrl: '' });
      const models = await p.discoverModels();
      expect(models).toEqual([]);
    });

    it('deduplicates default model from discovered', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'test-model' }, { id: 'other-model' }],
        }),
      } as Response);

      await provider.discoverModels();
      const all = provider.listModels();
      expect(all).toHaveLength(2); // test-model (deduped) + other-model
      expect(all.map((m) => m.id)).toEqual(['test-model', 'other-model']);
    });
  });

  describe('summarize', () => {
    it('calls /v1/chat/completions with correct payload', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Summary of conversation' } }],
        }),
      } as Response);

      const result = await provider.summarize('Long conversation text');
      expect(result).toBe('Summary of conversation');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8000/v1/chat/completions');
      expect(opts?.method).toBe('POST');

      const body = JSON.parse(opts?.body as string);
      expect(body.model).toBe('test-model');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('Long conversation text');

      const headers = opts?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
    });

    it('uses custom model when provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Summary' } }],
        }),
      } as Response);

      await provider.summarize('text', undefined, 'custom-model');
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1]?.body as string));
      expect(body.model).toBe('custom-model');
    });

    it('includes instructions when provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Summary' } }],
        }),
      } as Response);

      await provider.summarize('text', 'Focus on action items');
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1]?.body as string));
      expect(body.messages[0].content).toContain('Focus on action items');
    });

    it('throws when baseUrl not configured', async () => {
      const p = new OpenAICompatibleProvider({ id: 'x', name: 'Test', baseUrl: '' });
      await expect(p.summarize('text')).rejects.toThrow('base URL not configured');
    });

    it('throws when model not configured', async () => {
      const p = new OpenAICompatibleProvider({ id: 'x', name: 'Test', baseUrl: 'http://localhost' });
      await expect(p.summarize('text')).rejects.toThrow('model not configured');
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      await expect(provider.summarize('text')).rejects.toThrow('API error (500)');
    });

    it('throws on empty response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [] }),
      } as Response);

      await expect(provider.summarize('text')).rejects.toThrow('No content');
    });

    it('omits Authorization header when no apiKey', async () => {
      const p = new OpenAICompatibleProvider({
        id: 'x', name: 'X', baseUrl: 'http://localhost', defaultModel: 'model',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      } as Response);

      await p.summarize('text');
      const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('provider instances for each backend', () => {
    it('creates Ollama provider with correct defaults', () => {
      const ollama = new OpenAICompatibleProvider({
        id: 'ollama', name: 'Ollama',
        baseUrl: 'http://127.0.0.1:11434',
      });
      expect(ollama.id).toBe('ollama');
      expect(ollama.isConfigured()).toBe(true);
      expect(ollama.getContainerEnv()['OLLAMA_BASE_URL']).toBe('http://127.0.0.1:11434');
    });

    it('creates vLLM provider with correct defaults', () => {
      const vllm = new OpenAICompatibleProvider({
        id: 'vllm', name: 'vLLM',
        baseUrl: 'http://127.0.0.1:8000',
      });
      expect(vllm.id).toBe('vllm');
      expect(vllm.getContainerEnv()['VLLM_BASE_URL']).toBe('http://127.0.0.1:8000');
    });

    it('creates SGLang provider with correct defaults', () => {
      const sglang = new OpenAICompatibleProvider({
        id: 'sglang', name: 'SGLang',
        baseUrl: 'http://127.0.0.1:30000',
      });
      expect(sglang.id).toBe('sglang');
      expect(sglang.getContainerEnv()['SGLANG_BASE_URL']).toBe('http://127.0.0.1:30000');
    });

    it('creates llama.cpp provider with correct defaults', () => {
      const llamacpp = new OpenAICompatibleProvider({
        id: 'llamacpp', name: 'llama.cpp',
        baseUrl: 'http://127.0.0.1:8080',
      });
      expect(llamacpp.id).toBe('llamacpp');
      expect(llamacpp.getContainerEnv()['LLAMACPP_BASE_URL']).toBe('http://127.0.0.1:8080');
    });
  });
});
