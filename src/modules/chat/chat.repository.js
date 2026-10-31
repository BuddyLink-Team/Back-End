import Conversation from './conversation.model.js';
import Message from './message.model.js';
import '../parent/parent.model.js';
import '../playdate/playdate.model.js';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from './chat.constants.js';

const PARENT_FIELDS = 'fullName avatarUrl verification location';
const CHILD_FIELDS = 'displayName dateOfBirth gender interests';
const PLAYDATE_SUMMARY_FIELDS = 'activity scheduledDate time status location';

const CONVERSATION_BASE_POPULATE = [
  { path: 'participants', select: PARENT_FIELDS },
  { path: 'lastMessage.senderId', select: 'fullName avatarUrl' },
];

// Lightweight playdate info for conversation lists, headers and socket payloads
const PLAYDATE_SUMMARY_POPULATE = { path: 'playdateId', select: PLAYDATE_SUMMARY_FIELDS };

// Full playdate info (host + participants) for the playdate group chat detail view.
// hostParentId, hostChildId and participants must stay selected for the nested populate to work.
const PLAYDATE_DETAIL_POPULATE = {
  path: 'playdateId',
  select: `${PLAYDATE_SUMMARY_FIELDS} hostParentId hostChildId participants`,
  populate: [
    { path: 'hostParentId', select: PARENT_FIELDS },
    { path: 'hostChildId', select: CHILD_FIELDS },
    { path: 'participants.parentId', select: PARENT_FIELDS },
    { path: 'participants.childId', select: CHILD_FIELDS },
  ],
};

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
      .populate(CONVERSATION_BASE_POPULATE)
      .populate(PLAYDATE_SUMMARY_POPULATE)
      .sort({ updatedAt: -1 })
      .lean();
  }

  /**
   * Find conversation by ID with populated participants
   * @param {string|ObjectId} conversationId
   * @param {Object} [options]
   * @param {boolean} [options.withPlaydateDetails=false] - Populate playdate host & participants
   *   (needed by the playdate group chat detail view, too heavy for per-message broadcasts)
   * @returns {Promise<Object|null>}
   */
  async findConversationById(conversationId, { withPlaydateDetails = false } = {}) {
    return Conversation.findOne({ _id: conversationId, isActive: true })
      .populate(CONVERSATION_BASE_POPULATE)
      .populate(withPlaydateDetails ? PLAYDATE_DETAIL_POPULATE : PLAYDATE_SUMMARY_POPULATE)
      .lean();
  }

  /**
   * Create the group conversation of a playdate, or replace its participants with the given list.
   * A single atomic upsert so concurrent calls for the same playdate do not create duplicates.
   * @param {string|ObjectId} playdateId
   * @param {Array<string|ObjectId>} participantIds - Host and accepted parents
   * @returns {Promise<Object>} Conversation with playdate details populated
   */
  async upsertPlaydateConversation(playdateId, participantIds) {
    const conversation = await Conversation.findOneAndUpdate(
      { playdateId, type: CONVERSATION_TYPES.PLAYDATE, isActive: true },
      {
        $set: { participants: participantIds },
        $setOnInsert: {
          playdateId,
          type: CONVERSATION_TYPES.PLAYDATE,
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return this.findConversationById(conversation._id, { withPlaydateDetails: true });
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
    const pairKey = [parentIdA.toString(), parentIdB.toString()].sort().join('_');
    return Conversation.findOne({
      $or: [
        { pairKey, isActive: true },
        {
          type: CONVERSATION_TYPES.DIRECT,
          participants: { $all: [parentIdA, parentIdB], $size: 2 },
          isActive: true,
        },
      ],
    })
      .populate(CONVERSATION_BASE_POPULATE)
      .populate(PLAYDATE_SUMMARY_POPULATE)
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
   * Find messages for a conversation with cursor pagination
   * @param {string|ObjectId} conversationId
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {string} [options.before] - Message id cursor; returns messages older than it.
   *   ObjectIds are unique and time-ordered, unlike createdAt which can tie within a millisecond.
   * @returns {Promise<Array>}
   */
  async findMessages(conversationId, { limit = 50, before = null } = {}) {
    // Deleted messages stay in the list: ChatDTO shows a placeholder instead of their content
    const query = { conversationId };

    if (before) {
      query._id = { $lt: before };
    }

    const messages = await Message.find(query)
      .populate('senderId', 'fullName avatarUrl verification')
      .sort({ _id: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    // Return in chronological order
    return messages.reverse();
  }

  /**
   * Find a message (sender and conversation only)
   * @param {string|ObjectId} messageId
   * @returns {Promise<{ senderId: ObjectId, conversationId: ObjectId }|null>}
   */
  async findMessageById(messageId) {
    return Message.findById(messageId).select('senderId conversationId').lean();
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

    await Conversation.findByIdAndUpdate(conversationId, updateOps, { new: true });
    return this.findConversationById(conversationId);
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

  /**
   * Messages around a target one in its conversation (deleted ones included)
   * @param {string|ObjectId} conversationId
   * @param {Date} targetCreatedAt
   * @param {number} radius - Messages on each side
   * @returns {Promise<{ before: Array, after: Array }>} Chronological
   */
  async findSurroundingMessages(conversationId, targetCreatedAt, radius) {
    const find = (createdAt, order) =>
      Message.find({ conversationId, createdAt })
        .sort({ createdAt: order })
        .limit(radius)
        .populate('senderId', 'fullName avatarUrl')
        .lean();
    const [before, after] = await Promise.all([
      find({ $lt: targetCreatedAt }, -1),
      find({ $gt: targetCreatedAt }, 1),
    ]);
    return { before: before.reverse(), after };
  }

  /**
   * A message with its sender
   * @returns {Promise<Object|null>}
   */
  async findMessageWithSender(messageId) {
    return Message.findById(messageId).populate('senderId', 'fullName avatarUrl').lean();
  }

  /**
   * @param {Array<string|ObjectId>} messageIds
   * @returns {Promise<Array<{ _id: ObjectId, content: string }>>}
   */
  async findMessageContents(messageIds) {
    return Message.find({ _id: { $in: messageIds } }).select('content').lean();
  }

  /**
   * Mark a message as deleted
   * @returns {Promise<Object|null>} null when it was already deleted
   */
  async softDeleteMessage(messageId) {
    return Message.findOneAndUpdate({ _id: messageId, isDeleted: false }, { $set: { isDeleted: true } }, { new: true }).lean();
  }

  /**
   * Replace the conversation preview when it shows the given message
   */
  async replaceLastMessageContent(conversationId, messageId, content) {
    return Conversation.updateOne(
      { _id: conversationId, 'lastMessage.messageId': messageId },
      { $set: { 'lastMessage.content': content, 'lastMessage.type': MESSAGE_TYPES.TEXT } }
    );
  }

  /**
   * Messages deleted from now on, whichever process deletes them
   * @returns {import('mongodb').ChangeStream}
   */
  watchDeletedMessages() {
    return Message.watch(
      [{ $match: { operationType: 'update', 'updateDescription.updatedFields.isDeleted': true } }],
      { fullDocument: 'updateLookup' }
    );
  }
}

export const chatRepository = new ChatRepository();
export default chatRepository;
