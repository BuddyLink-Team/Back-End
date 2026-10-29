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

  /**
   * Count user messages between dates
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Promise<number>}
   */
  async countUserMessagesBetween(fromDate, toDate) {
    const rows = await AIChatSession.aggregate([
      { $unwind: '$messages' },
      {
        $match: {
          'messages.role': 'user',
          'messages.timestamp': { $gte: fromDate, $lte: toDate },
        },
      },
      { $count: 'count' },
    ]);
    return rows[0]?.count || 0;
  }

  /**
   * Count user messages on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countUserMessagesBeforeDate(date) {
    const match = { 'messages.role': 'user' };
    if (date) match['messages.timestamp'] = { $lte: date };
    const rows = await AIChatSession.aggregate([
      { $unwind: '$messages' },
      { $match: match },
      { $count: 'count' },
    ]);
    return rows[0]?.count || 0;
  }

  /**
   * Aggregate AI user requests by period
   * @param {Date} fromDate
   * @param {Date} toDate
   * @param {string} dateFormat
   * @param {string} timeZone
   * @returns {Promise<Array<{ period: string, count: number }>>}
   */
  async aggregateAiUsageByPeriod(fromDate, toDate, dateFormat, timeZone) {
    const rows = await AIChatSession.aggregate([
      { $unwind: '$messages' },
      {
        $match: {
          'messages.role': 'user',
          'messages.timestamp': { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$messages.timestamp', timezone: timeZone } },
          requestCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ period: r._id, count: r.requestCount }));
  }

  /**
   * Find top parents by AI requests in period
   * @param {Date} fromDate
   * @param {Date} toDate
   * @param {number} [limit=5]
   * @returns {Promise<Array<{ parentId: ObjectId, requestCount: number }>>}
   */
  async getTopParentsByUsage(fromDate, toDate, limit = 5) {
    const rows = await AIChatSession.aggregate([
      { $unwind: '$messages' },
      {
        $match: {
          'messages.role': 'user',
          'messages.timestamp': { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: '$parentId',
          requestCount: { $sum: 1 },
        },
      },
      { $sort: { requestCount: -1 } },
      { $limit: limit },
    ]);
    return rows.map((r) => ({ parentId: r._id, requestCount: r.requestCount }));
  }
}

export const aiAssistantRepository = new AIAssistantRepository();
export default aiAssistantRepository;
