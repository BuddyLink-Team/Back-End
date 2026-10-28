import AIChatSession from './ai-assistant.model.js';
import { AI_LIMITS } from './ai-assistant.constants.js';

// List items never carry the conversation itself
const SESSION_LIST_PROJECTION = { messages: 0, planDraft: 0 };

class AIAssistantRepository {
  async create({ parentId, title }) {
    const session = await AIChatSession.create({ parentId, title });
    return session.toObject();
  }

  async findActiveByIdAndParent(id, parentId) {
    return AIChatSession.findOne({ _id: id, parentId, isActive: true }).lean();
  }

  /**
   * Active sessions of a parent, most recently updated first
   * @returns {Promise<{ sessions: Array<Object>, total: number }>}
   */
  async listByParent(parentId, { page, limit }) {
    const filter = { parentId, isActive: true };
    const [sessions, total] = await Promise.all([
      AIChatSession.find(filter, SESSION_LIST_PROJECTION)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AIChatSession.countDocuments(filter),
    ]);
    return { sessions, total };
  }

  async softDelete(id, parentId) {
    return AIChatSession.findOneAndUpdate(
      { _id: id, parentId, isActive: true },
      { $set: { isActive: false, deletedAt: new Date(), pendingSince: null } },
      { new: true }
    ).lean();
  }

  /**
   * Mark the session as busy unless a reply is already being generated (a lock older than
   * PENDING_LOCK_MS is stale and taken over)
   * @returns {Promise<Object|null>} The session, or null when missing or busy
   */
  async acquireLock(id, parentId, now = new Date()) {
    return AIChatSession.findOneAndUpdate(
      {
        _id: id,
        parentId,
        isActive: true,
        $or: [{ pendingSince: null }, { pendingSince: { $lt: new Date(now.getTime() - AI_LIMITS.PENDING_LOCK_MS) } }],
      },
      { $set: { pendingSince: now } },
      { new: true }
    ).lean();
  }

  async releaseLock(id) {
    await AIChatSession.updateOne({ _id: id }, { $set: { pendingSince: null } });
  }

  /**
   * Store one turn and release the lock
   * @param {string} id
   * @param {Object} turn
   * @param {Array<Object>} turn.messages - Appended in order
   * @param {{ promptTokens: number, completionTokens: number, totalTokens: number }} turn.tokenDelta
   * @param {Object|null} turn.planDraft
   * @param {string} [turn.title] - Only on the first message
   * @param {Date} [turn.quotaConsumedAt] - Only when this turn used the session's quota unit
   * @param {{ messageId: string, cards: Array<Object> }} [turn.answeredCard] - Earlier message whose choice card was answered
   * @returns {Promise<Object>} The updated session
   */
  async appendTurn(id, { messages, tokenDelta, planDraft, title, quotaConsumedAt, answeredCard }) {
    // A positional update of messages.$[] cannot run in the same update as $push on messages
    if (answeredCard) {
      await AIChatSession.updateOne(
        { _id: id },
        { $set: { 'messages.$[message].cards': answeredCard.cards } },
        { arrayFilters: [{ 'message._id': answeredCard.messageId }] }
      );
    }

    const set = { planDraft, lastMessageAt: new Date(), pendingSince: null };
    if (title) set.title = title;
    if (quotaConsumedAt) set.quotaConsumedAt = quotaConsumedAt;

    return AIChatSession.findByIdAndUpdate(
      id,
      {
        $push: { messages: { $each: messages } },
        $inc: {
          messageCount: 1,
          'tokenUsage.promptTokens': tokenDelta.promptTokens,
          'tokenUsage.completionTokens': tokenDelta.completionTokens,
          'tokenUsage.totalTokens': tokenDelta.totalTokens,
        },
        $set: set,
      },
      { new: true }
    ).lean();
  }
}

export const aiAssistantRepository = new AIAssistantRepository();
export default aiAssistantRepository;
