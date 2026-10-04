import Conversation from './conversation.model.js';
import Message from './message.model.js';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from './chat.constants.js';
import logger from '../../shared/logger/index.js';

class ChatService {
  /**
   * Create dedicated playdate group chat conversation
   * @param {string|ObjectId} playdateId
   * @param {string|ObjectId} hostParentId
   * @param {Array<string|ObjectId>} participantParentIds
   * @param {string} activityTitle
   * @returns {Promise<Conversation|null>}
   */
  async createPlaydateConversation(playdateId, hostParentId, participantParentIds = [], activityTitle = '') {
    try {
      const allParentIds = [
        hostParentId.toString(),
        ...participantParentIds.map((p) => p.toString()),
      ].filter(Boolean);
      const uniqueParentIds = [...new Set(allParentIds)];

      const conversation = await Conversation.create({
        type: CONVERSATION_TYPES.PLAYDATE,
        playdateId,
        participants: uniqueParentIds,
        isActive: true,
      });

      const initialMessage = await Message.create({
        conversationId: conversation._id,
        senderId: hostParentId,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Buổi hẹn "${activityTitle}" đã được tạo thành công. Các phụ huynh có thể trao đổi tại đây.`,
      });

      conversation.lastMessage = {
        messageId: initialMessage._id,
        senderId: hostParentId,
        content: initialMessage.content,
        type: MESSAGE_TYPES.SYSTEM,
        sentAt: new Date(),
      };
      await conversation.save();

      return conversation;
    } catch (chatError) {
      logger.error(`Failed to create playdate group chat for playdate ${playdateId}: ${chatError.message}`, {
        error: chatError.stack,
      });
      return null;
    }
  }
}

export default new ChatService();
