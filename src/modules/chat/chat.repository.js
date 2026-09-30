import Conversation from './conversation.model.js';
import Message from './message.model.js';
import '../parent/parent.model.js';
import '../playdate/playdate.model.js';
import { CONVERSATION_TYPES } from './chat.constants.js';

class ChatRepository {
  /**
   * Find all conversations that a parent participates in
   * @param {string|ObjectId} parentId
   * @param {Object} [filter]
   * @returns {Promise<Array>}
   */
  async findUserConversations(parentId, filter = {}) {
    const query = {
      participants: parentId,
      isActive: true,
    };

    if (filter.type && Object.values(CONVERSATION_TYPES).includes(filter.type)) {
      query.type = filter.type;
    }

    return Conversation.find(query)
      .populate('participants', 'fullName avatarUrl verification location')
      .populate('lastMessage.senderId', 'fullName avatarUrl')
      .populate('playdateId', 'title scheduledDate status location')
      .sort({ updatedAt: -1 })
      .lean();
  }

  /**
   * Find conversation by ID with populated participants
   * @param {string|ObjectId} conversationId
   * @returns {Promise<Object|null>}
   */
  async findConversationById(conversationId) {
    return Conversation.findOne({ _id: conversationId, isActive: true })
      .populate('participants', 'fullName avatarUrl verification location')
      .populate('lastMessage.senderId', 'fullName avatarUrl')
      .populate('playdateId', 'title scheduledDate status location')
      .lean();
  }

  /**
   * Find raw conversation document by ID (for updates)
   * @param {string|ObjectId} conversationId
   * @returns {Promise<Document|null>}
   */
  async findConversationDocById(conversationId) {
    return Conversation.findOne({ _id: conversationId, isActive: true });
  }

  /**
   * Find an existing direct conversation between two parents
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<Object|null>}
   */
  async findDirectConversation(parentIdA, parentIdB) {
    return Conversation.findOne({
      type: CONVERSATION_TYPES.DIRECT,
      participants: { $all: [parentIdA, parentIdB], $size: 2 },
      isActive: true,
    })
      .populate('participants', 'fullName avatarUrl verification location')
      .populate('lastMessage.senderId', 'fullName avatarUrl')
      .lean();
  }

  /**
   * Create a new conversation document
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async createConversation(data) {
    const conversation = await Conversation.create(data);
    return this.findConversationById(conversation._id);
  }

  /**
   * Find messages for a conversation with pagination
   * @param {string|ObjectId} conversationId
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  async findMessages(conversationId, { limit = 50, before = null } = {}) {
    const query = {
      conversationId,
      isDeleted: false,
    };

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .populate('senderId', 'fullName avatarUrl verification')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    // Return in chronological order
    return messages.reverse();
  }

  /**
   * Create a new message
   * @param {Object} messageData
   * @returns {Promise<Object>}
   */
  async createMessage(messageData) {
    const message = await Message.create(messageData);
    return Message.findById(message._id)
      .populate('senderId', 'fullName avatarUrl verification')
      .lean();
  }

  /**
   * Update conversation's lastMessage and unread counts for recipients
   * @param {string|ObjectId} conversationId
   * @param {Object} messageDoc
   * @param {Array<string|ObjectId>} recipientIds
   */
  async updateLastMessage(conversationId, messageDoc, recipientIds = []) {
    const updateOps = {
      $set: {
        'lastMessage.messageId': messageDoc._id,
        'lastMessage.senderId': messageDoc.senderId._id || messageDoc.senderId,
        'lastMessage.content': messageDoc.content,
        'lastMessage.type': messageDoc.type,
        'lastMessage.sentAt': messageDoc.createdAt || new Date(),
        updatedAt: new Date(),
      },
    };

    if (recipientIds.length > 0) {
      const incOps = {};
      recipientIds.forEach((id) => {
        incOps[`unreadCounts.${id}`] = 1;
      });
      updateOps.$inc = incOps;
    }

    return Conversation.findByIdAndUpdate(conversationId, updateOps, { new: true });
  }

  /**
   * Mark messages in a conversation as read by a parent
   * @param {string|ObjectId} conversationId
   * @param {string|ObjectId} parentId
   */
  async markMessagesAsRead(conversationId, parentId) {
    const readEntry = {
      parentId,
      readAt: new Date(),
    };

    await Message.updateMany(
      {
        conversationId,
        senderId: { $ne: parentId },
        'readBy.parentId': { $ne: parentId },
      },
      {
        $push: { readBy: readEntry },
      }
    );
  }

  /**
   * Reset unread counter for a specific parent in conversation
   * @param {string|ObjectId} conversationId
   * @param {string|ObjectId} parentId
   */
  async resetUnreadCount(conversationId, parentId) {
    return Conversation.findByIdAndUpdate(
      conversationId,
      {
        $set: {
          [`unreadCounts.${parentId}`]: 0,
        },
      },
      { new: true }
    );
  }
}

export const chatRepository = new ChatRepository();
export default chatRepository;
