import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/app-error.js';

const ThinkingLevel = Object.freeze({
  LOW: 'LOW',
  HIGH: 'HIGH',
});

const RETRYABLE_STATUS = new Set([429, 503]);
const DEFAULT_COOLDOWN_MS = 60 * 1000;
const MAX_COOLDOWN_MS = 60 * 60 * 1000;

// How long a rate-limited model is skipped: the provider's retryDelay when given, capped so a model is retried hourly
const cooldownMs = (error) => {
  const seconds = Number(String(error?.message || '').match(/"retryDelay":"(\d+(?:\.\d+)?)s"/)?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_COOLDOWN_MS) : DEFAULT_COOLDOWN_MS;
};
const GENERATION_DEFAULTS = Object.freeze({
  temperature: 0.4,
  maxOutputTokens: 1024,
  // Picking a tool and writing 2-4 sentences needs little reasoning; the default level adds seconds per call
  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
});

const isConfigured = () => Boolean(env.AI.GEMINI_API_KEY && !env.AI.GEMINI_API_KEY.startsWith('<'));

const toUsage = (metadata = {}) => ({
  promptTokens: metadata.promptTokenCount || 0,
  completionTokens: (metadata.candidatesTokenCount || 0) + (metadata.thoughtsTokenCount || 0),
  totalTokens: metadata.totalTokenCount || 0,
});

const providerError = () => new AppError('AI assistant is temporarily unavailable', 502, 'AI_PROVIDER_ERROR');

/**
 * Google Gemini (the only file importing @google/genai).
 * Errors never leak provider details to the client: they are logged and mapped to AppError codes.
 */
class GeminiAdapter {
  constructor() {
    this._client = null;
    // model -> time until which it is skipped after a 429, so every call does not pay a failed request first
    this._rateLimitedUntil = new Map();
  }

  /**
   * Created on first use, so tests and environments without a key never build it
   * @private
   */
  _getClient() {
    if (!isConfigured()) {
      throw new AppError('AI assistant is not configured', 503, 'AI_UNAVAILABLE');
    }
    if (!this._client) {
      this._client = new GoogleGenAI({ apiKey: env.AI.GEMINI_API_KEY });
    }
    return this._client;
  }

  /**
   * One generation call, retried once on the fallback model when the main one is rate limited or overloaded.
   * @param {Object} params
   * @param {string} params.systemInstruction
   * @param {Array<Object>} params.contents - Gemini contents (role 'user' | 'model', parts[])
   * @param {Array<Object>} [params.functionDeclarations]
   * @param {boolean} [params.allowTools=true] - false forces a text answer
   * @param {number} [params.deadline] - Epoch ms after which no call is made or kept waiting (the fallback included)
   * @returns {Promise<{ text: string, functionCalls: Array<{ id?: string, name: string, args: Object }>,
   *   content: Object|null, usage: { promptTokens: number, completionTokens: number, totalTokens: number }, model: string }>}
   *   `content` is the raw model turn, to be sent back as is (it carries the thought signatures of function calls)
   */
  async generateContent({ systemInstruction, contents, functionDeclarations = [], allowTools = true, deadline = Infinity }) {
    const client = this._getClient();
    const configured = [env.AI.GEMINI_MODEL, env.AI.GEMINI_FALLBACK_MODEL].filter(
      (model, index, list) => model && list.indexOf(model) === index
    );
    const now = Date.now();
    const available = configured.filter((model) => !(this._rateLimitedUntil.get(model) > now));
    // All rate limited: still try the last one rather than fail without asking
    const models = available.length ? available : configured.slice(-1);

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const timeoutMs = Math.min(env.AI.REQUEST_TIMEOUT_MS, deadline - Date.now());
      if (timeoutMs <= 0) {
        logger.warn(`[GeminiAdapter] turn deadline reached before calling ${model}`);
        throw providerError();
      }
      try {
        const result = await this._generate(client, model, {
          systemInstruction,
          contents,
          functionDeclarations,
          allowTools,
          timeoutMs,
        });
        this._rateLimitedUntil.delete(model);
        return result;
      } catch (error) {
        const status = error?.status;
        if (status === 429) this._rateLimitedUntil.set(model, Date.now() + cooldownMs(error));
        // AbortError = our REQUEST_TIMEOUT_MS fired: the model is slow right now, the fallback may still answer
        const timedOut = error?.name === 'AbortError';
        const canRetry = (RETRYABLE_STATUS.has(status) || timedOut) && index < models.length - 1;
        logger.warn(`[GeminiAdapter] ${model} failed (${status || error?.name}): ${error?.message}`);
        if (canRetry) continue;
        if (status === 429) {
          throw new AppError('AI assistant is busy, please try again in a few minutes', 429, 'AI_RATE_LIMITED');
        }
        throw providerError();
      }
    }
    throw providerError();
  }

  /** @private */
  async _generate(client, model, { systemInstruction, contents, functionDeclarations, allowTools, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const hasTools = functionDeclarations.length > 0;
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          ...GENERATION_DEFAULTS,
          systemInstruction,
          abortSignal: controller.signal,
          ...(hasTools
            ? {
                tools: [{ functionDeclarations }],
                toolConfig: {
                  functionCallingConfig: {
                    mode: allowTools ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE,
                  },
                },
              }
            : {}),
        },
      });

      const content = response.candidates?.[0]?.content || null;
      const functionCalls = (response.functionCalls || []).map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args || {},
      }));
      // Text parts only (response.text warns when the turn also has function calls); thoughts are internal
      const text = (content?.parts || [])
        .filter((part) => typeof part.text === 'string' && !part.thought)
        .map((part) => part.text)
        .join('')
        .trim();
      if (!text && functionCalls.length === 0) {
        throw Object.assign(new Error('Empty response from Gemini'), { status: 502 });
      }
      return { text, functionCalls, content, usage: toUsage(response.usageMetadata), model };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Models available to the configured key (used by scripts/check-gemini.js)
   * @returns {Promise<string[]>}
   */
  async listModels() {
    const client = this._getClient();
    const names = [];
    const pager = await client.models.list();
    for await (const model of pager) {
      if ((model.supportedActions || []).includes('generateContent')) names.push(model.name);
    }
    return names;
  }
}

export const geminiAdapter = new GeminiAdapter();
export default geminiAdapter;
