import Playdate from './playdate.model.js';
import '../parent/parent.model.js';
import '../child/child.model.js';

class PlaydateRepository {
  /**
   * Find playdate by ID
   * @param {string|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return Playdate.findById(id).lean();
  }

  /**
   * Find playdate document by ID (for updates)
   * @param {string|ObjectId} id
   * @returns {Promise<Document|null>}
   */
  async findDocById(id) {
    return Playdate.findById(id);
  }

  /**
   * Find playdate with full details (populated host & participants)
   * @param {string|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  async findWithDetails(id) {
    return Playdate.findById(id)
      .populate('hostParentId', 'fullName avatarUrl verification location')
      .populate('hostChildId', 'displayName dateOfBirth gender interests')
      .populate('participants.parentId', 'fullName avatarUrl verification location')
      .populate('participants.childId', 'displayName dateOfBirth gender interests')
      .lean();
  }

  /**
   * Update chatConversationId on a playdate
   * @param {string|ObjectId} playdateId
   * @param {string|ObjectId} conversationId
   */
  async updateChatConversationId(playdateId, conversationId) {
    return Playdate.findByIdAndUpdate(
      playdateId,
      { $set: { chatConversationId: conversationId } },
      { new: true }
    );
  }
}

export const playdateRepository = new PlaydateRepository();
export default playdateRepository;
