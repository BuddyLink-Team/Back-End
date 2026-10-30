import mongoose from 'mongoose';
import aiAssistantRepository from './ai-assistant.repository.js';
import parentService from '../parent/parent.service.js';
import userService from '../user/user.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import geminiAdapter from '../../integrations/ai/gemini.adapter.js';
import AppError from '../../shared/exceptions/app-error.js';
import logger from '../../shared/logger/index.js';
import {
  AI_MESSAGE_ROLES,
  AI_CARD_TYPES,
  AI_LIMITS,
  AI_SESSION_MESSAGE_CAP,
  AI_DEFAULT_SESSION_TITLE,
  AI_FALLBACK_REPLY,
  AI_CHOICE_FALLBACK_REPLY,
} from './ai-assistant.constants.js';
import { AIMessageDTO, AISessionDTO } from './ai-assistant.dto.js';
import { buildSystemPrompt } from './ai-assistant.prompt.js';
import { buildTitle, toGeminiContents, selectCards, cleanReply } from './conversation.rules.js';
import { toDraftResponse } from './plan-draft.rules.js';
import { functionDeclarations, executeTool } from './tools/index.js';
import { createToolContext } from './tools/tool-context.js';
import { applyChoice } from './tools/choice-handler.js';
import { stripSensitive } from './tools/tool-sanitizer.js';

const QUOTA_ACTION = 'aiAssistant';
const EMPTY_USAGE = Object.freeze({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

const addUsage = (total, usage = EMPTY_USAGE) => ({
  promptTokens: total.promptTokens + usage.promptTokens,
  completionTokens: total.completionTokens + usage.completionTokens,
  totalTokens: total.totalTokens + usage.totalTokens,
});

const sessionNotFound = () => new AppError('Chat session not found', 404, 'AI_SESSION_NOT_FOUND');

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

// Latest playmate list shown in the session, so "send them a request" knows who "them" is
const lastMatchCardOf = (messages = []) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const card = (messages[index].cards || []).findLast((item) => item.type === AI_CARD_TYPES.MATCH_SUGGESTIONS);
    if (card) return card;
  }
  return null;
};

class AIAssistantService {
  /** @private */
  async _getParent(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }
    return parent;
  }

  /**
   * Messages allowed in one session for this parent's plan, with the current monthly usage
   * @private
   */
  async _getLimits(parentId) {
    const usage = await subscriptionService.getActionUsage(parentId, QUOTA_ACTION);
    return { usage, messageCap: usage.isPremium ? AI_SESSION_MESSAGE_CAP.PREMIUM : AI_SESSION_MESSAGE_CAP.FREE };
  }

  /**
   * POST /ai-assistant/sessions — free: the quota unit is used by the first successful reply
   */
  async createSession(userId) {
    const parent = await this._getParent(userId);
    const session = await aiAssistantRepository.create({ parentId: parent._id, title: AI_DEFAULT_SESSION_TITLE });
    const { messageCap } = await this._getLimits(parent._id);
    return { session: AISessionDTO.toSummary(session, messageCap) };
  }

  /**
   * GET /ai-assistant/sessions
   */
  async listSessions(userId, { page, limit } = {}) {
    const parent = await this._getParent(userId);
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(AI_LIMITS.SESSIONS_MAX_PAGE_SIZE, Math.max(1, parseInt(limit, 10) || AI_LIMITS.SESSIONS_PAGE_SIZE));
    const { sessions, total } = await aiAssistantRepository.listByParent(parent._id, { page: currentPage, limit: pageSize });
    return {
      sessions: sessions.map(AISessionDTO.toListItem),
      pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * GET /ai-assistant/sessions/:id — another parent's session is reported as not found
   */
  async getSession(userId, sessionId) {
    const parent = await this._getParent(userId);
    const session = await aiAssistantRepository.findActiveByIdAndParent(sessionId, parent._id);
    if (!session) throw sessionNotFound();
    const { messageCap } = await this._getLimits(parent._id);
    return { session: AISessionDTO.toDetail(session, messageCap) };
  }

  /**
   * DELETE /ai-assistant/sessions/:id (soft delete)
   */
  async deleteSession(userId, sessionId) {
    const parent = await this._getParent(userId);
    const deleted = await aiAssistantRepository.softDelete(sessionId, parent._id);
    if (!deleted) throw sessionNotFound();
  }

  /**
   * POST /ai-assistant/sessions/:id/messages
   *
   * Quota: a session uses one monthly unit, taken by its first message and given back when that turn
   * fails; later messages are free up to the per-session cap. Nothing is stored when the turn fails, so
   * the parent can retry the same message, except after a tapped option that already took effect.
   *
   * @param {string} userId
   * @param {string} sessionId
   * @param {{ content: string, choice?: { messageId: string, stepId: string, optionIds?: string[], custom?: Object } }} input
   */
  async sendMessage(userId, sessionId, { content, choice }) {
    const parent = await this._getParent(userId);
    const session = await aiAssistantRepository.acquireLock(sessionId, parent._id);
    if (!session) {
      const exists = await aiAssistantRepository.findActiveByIdAndParent(sessionId, parent._id);
      if (!exists) throw sessionNotFound();
      throw new AppError('A reply is already being prepared for this conversation', 409, 'AI_SESSION_BUSY');
    }

    try {
      return await this._runTurn(userId, parent, session, { content: content.trim(), choice });
    } catch (error) {
      await aiAssistantRepository.releaseLock(session._id);
      throw error;
    }
  }

  /** @private */
  async _runTurn(userId, parent, session, { content, choice }) {
    const startedAt = Date.now();
    const { usage, messageCap } = await this._getLimits(parent._id);
    if ((session.messageCount || 0) >= messageCap) {
      throw new AppError('This conversation is full, please start a new one', 409, 'AI_SESSION_FULL', { cap: messageCap });
    }

    // The unit is taken atomically before the model runs (parallel sessions cannot go over the limit)
    // and given back when the turn is not stored
    const isFirstBilled = !session.quotaConsumedAt;
    let quota = { limit: usage.limit, used: usage.used, remaining: usage.remaining };
    if (isFirstBilled) {
      const consumed = await subscriptionService.checkAndConsumeQuota(parent._id, QUOTA_ACTION, true);
      quota = { limit: consumed.limit, used: consumed.currentUsed, remaining: consumed.remaining };
    }

    try {
      return await this._completeTurn(userId, parent, session, { content, choice, startedAt, messageCap, quota, isFirstBilled });
    } catch (error) {
      if (isFirstBilled) {
        await subscriptionService
          .refundQuota(parent._id, QUOTA_ACTION)
          .catch((refundError) => logger.error(`[AIAssistant] quota refund failed for parent=${parent._id}: ${refundError.message}`));
      }
      throw error;
    }
  }

  /** @private */
  async _completeTurn(userId, parent, session, { content, choice, startedAt, messageCap, quota, isFirstBilled }) {
    const deadline = startedAt + AI_LIMITS.TURN_TIMEOUT_MS;
    const draft = session.planDraft ? structuredClone(session.planDraft) : null;
    const ctx = createToolContext({ userId, parent, draft, lastMatchCard: lastMatchCardOf(session.messages) });

    // A tapped option is applied by code before the model answers
    let answeredCard = null;
    let systemNote = '';
    let allowTools = true;
    if (choice) {
      ({ answeredCard, note: systemNote, allowTools } = await applyChoice(ctx, session, choice));
    }

    let generated;
    try {
      generated = await this._generateReply(ctx, session, content, systemNote, { allowTools, deadline });
    } catch (error) {
      // The tapped option already took effect (playdate created, requests sent, plan updated): the turn is
      // stored with a plain reply, so a retry cannot repeat it
      if (!answeredCard) throw error;
      logger.warn(`[AIAssistant] session=${session._id} reply failed after a choice (${error.code || error.message}), stored with the fallback reply`);
      generated = { text: AI_CHOICE_FALLBACK_REPLY, toolMessages: [], tokenDelta: { ...EMPTY_USAGE }, rounds: 0, model: null };
    }
    const { text, toolMessages, tokenDelta, rounds, model } = generated;
    const cards = stripSensitive(selectCards(ctx.turn.cards));

    const now = new Date();
    const userMessage = {
      _id: new mongoose.Types.ObjectId(),
      role: AI_MESSAGE_ROLES.USER,
      content,
      ...(choice
        ? { choice: { messageId: choice.messageId, stepId: choice.stepId, optionIds: (choice.optionIds || []).map(String) } }
        : {}),
      timestamp: now,
    };
    const reply = {
      _id: new mongoose.Types.ObjectId(),
      role: AI_MESSAGE_ROLES.ASSISTANT,
      content: text,
      cards,
      toolsUsed: [...new Set(ctx.turn.toolsUsed)],
      timestamp: new Date(),
    };

    const updated = await aiAssistantRepository.appendTurn(session._id, {
      messages: [userMessage, ...toolMessages, reply],
      tokenDelta,
      planDraft: ctx.draft,
      title: session.messageCount ? undefined : buildTitle(content),
      quotaConsumedAt: isFirstBilled ? now : undefined,
      answeredCard,
    });

    logger.info(
      `[AIAssistant] parent=${parent._id} session=${session._id} model=${model} rounds=${rounds} ` +
        `tools=${reply.toolsUsed.join(',') || '-'} tokens=${tokenDelta.totalTokens} ms=${Date.now() - startedAt}`
    );

    return {
      session: AISessionDTO.toSummary(updated, messageCap),
      userMessage: AIMessageDTO.toResponse(userMessage),
      reply: AIMessageDTO.toResponse(reply),
      planDraft: toDraftResponse(ctx.draft),
      // The tapped card as stored (answer, created playdate id), so the client shows it without reloading
      answeredCard: answeredCard ? { messageId: answeredCard.messageId.toString(), cards: answeredCard.cards } : null,
      quota,
    };
  }

  /**
   * Model loop: up to MAX_TOOL_ROUNDS rounds of tool calls, then one last call without tools so the
   * turn always ends with text (at most MAX_TOOL_ROUNDS + 1 model calls). Without tools (e.g. the action of
   * a tap is done and only a comment is needed) it is a single call. Every call ends by the turn deadline,
   * and the tool rounds stop early when only the time for a last answer is left.
   * @private
   */
  async _generateReply(ctx, session, content, systemNote, { allowTools: toolsAllowed = true, deadline = Infinity } = {}) {
    // A failed lookup leaves the children unknown: the model can still call getMyChildren
    const children = await ctx.getChildren().catch(() => null);
    const systemInstruction = buildSystemPrompt({
      parentName: ctx.parent.fullName,
      area: [ctx.parent.location?.area, ctx.parent.location?.city].filter(Boolean).join(', '),
      children,
      planDraft: ctx.draft,
    });
    const userText = systemNote ? `${content}\n\n${systemNote}` : content;
    const contents = toGeminiContents(session.messages, userText);

    const toolMessages = [];
    let tokenDelta = { ...EMPTY_USAGE };
    let text = '';
    let model = null;
    let rounds = 0;

    for (let round = toolsAllowed ? 0 : AI_LIMITS.MAX_TOOL_ROUNDS; round <= AI_LIMITS.MAX_TOOL_ROUNDS; round += 1) {
      const allowTools = round < AI_LIMITS.MAX_TOOL_ROUNDS && deadline - Date.now() > AI_LIMITS.FINAL_REPLY_RESERVE_MS;
      const response = await geminiAdapter.generateContent({
        systemInstruction,
        contents,
        functionDeclarations,
        allowTools,
        deadline,
      });
      tokenDelta = addUsage(tokenDelta, response.usage);
      model = response.model;
      rounds += 1;

      if (!allowTools || !response.functionCalls.length) {
        text = response.text;
        break;
      }

      const calls = response.functionCalls.map((call, index) => ({ ...call, id: call.id || `call_${round}_${index}` }));
      // The raw model turn is sent back as is: it carries the signatures of its function calls
      contents.push(
        response.content || {
          role: 'model',
          parts: calls.map((call) => ({ functionCall: { id: call.id, name: call.name, args: call.args } })),
        }
      );
      toolMessages.push({
        _id: new mongoose.Types.ObjectId(),
        role: AI_MESSAGE_ROLES.ASSISTANT,
        content: '',
        toolCalls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
        timestamp: new Date(),
      });

      // One after another: the planning tools share the draft
      const responseParts = [];
      for (const call of calls) {
        const result = await executeTool(call.name, call.args, ctx);
        responseParts.push({ functionResponse: { id: call.id, name: call.name, response: result } });
        toolMessages.push({
          _id: new mongoose.Types.ObjectId(),
          role: AI_MESSAGE_ROLES.TOOL,
          toolCallId: call.id,
          toolName: call.name,
          content: truncate(JSON.stringify(result), AI_LIMITS.TOOL_RESULT_MAX_LENGTH),
          timestamp: new Date(),
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    return { text: cleanReply(text) || AI_FALLBACK_REPLY, toolMessages, tokenDelta, rounds, model };
  }

  /**
   * Count user messages between dates
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Promise<number>}
   */
  async countAiMessagesBetween(fromDate, toDate) {
    return aiAssistantRepository.countUserMessagesBetween(fromDate, toDate);
  }

  /**
   * Get AI analytics with period breakdown and top parents
   * @param {{ fromDate: Date, toDate: Date, dateFormat: string, timeZone: string, topLimit: number }} params
   * @returns {Promise<{ timeline: Array<{ period: string, count: number }>, topParents: Array<Object> }>}
   */
  async getAiAnalytics({ fromDate, toDate, dateFormat, timeZone, topLimit }) {
    const [timeline, topParentRows] = await Promise.all([
      aiAssistantRepository.aggregateAiUsageByPeriod(fromDate, toDate, dateFormat, timeZone),
      aiAssistantRepository.getTopParentsByUsage(fromDate, toDate, topLimit),
    ]);

    const parentIds = topParentRows.map((r) => r.parentId);
    const parents = await parentService.getParentsByIds(parentIds);
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));

    const userIds = parents.map((p) => p.userId).filter(Boolean);
    const emails = await userService.getEmailsByIds(userIds);
    const emailMap = new Map(emails.map((e) => [e._id.toString(), e.email]));

    const topParents = topParentRows.map((row) => {
      const p = parentMap.get(row.parentId.toString());
      const email = p?.userId ? emailMap.get(p.userId.toString()) || null : null;
      return {
        parentId: row.parentId,
        fullName: p?.fullName || 'N/A',
        avatarUrl: p?.avatarUrl || null,
        email,
        requestCount: row.requestCount,
      };
    });

    return { timeline, topParents };
  }
}

export const aiAssistantService = new AIAssistantService();
export default aiAssistantService;
