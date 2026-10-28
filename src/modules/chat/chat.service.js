import chatRepository from './chat.repository.js';
import parentService from '../parent/parent.service.js';
import playdateService from '../playdate/playdate.service.js';
import safetyService from '../safety/safety.service.js';
import connectionService from '../connection/connection.service.js';
import storageAdapter from '../../integrations/storage/storage.adapter.js';
import AppError from '../../shared/exceptions/app-error.js';
import { MESSAGE_PRIVACY } from '../parent/parent.constants.js';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from './chat.constants.js';

class ChatService {
  /**
   * Resolve the caller's parent profile from a parent object (socket handshake) or a userId (REST).
   * A bare id is always treated as a userId: guessing between userId and parentId is ambiguous.
   * @private
   */
  async _resolveParent(parentOrUserId) {
    if (!parentOrUserId) {
      throw new AppError('User or parent ID is required', 400, 'ID_REQUIRED');
    }

    // Already a parent object/doc. Checked on `_id` only: an ObjectId also exposes an `id` getter.
    if (typeof parentOrUserId === 'object' && parentOrUserId._id) {
      return parentOrUserId;
    }

    const parent = await parentService.getParentByUserId(parentOrUserId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    return parent;
  }

  /**
   * Get the parent profile of the authenticated user (chat is parent-only)
   * @param {string} userId
   */
  async getCallerParent(userId) {
    return this._resolveParent(userId);
  }

  /**
   * Check that a parent is a member of a conversation (and still accepted for playdate chats)
   * @private
   */
  async _assertConversationAccess(conversation, parentId) {
    const parentIdStr = parentId.toString();
    const isParticipant = (conversation.participants || []).some(
      (p) => (p._id || p).toString() === parentIdStr
    );

    if (!isParticipant) {
      throw new AppError('You do not have access to this conversation', 403, 'FORBIDDEN_CONVERSATION_ACCESS');
    }

    // Only the host and accepted participants may read or send in a playdate group chat
    if (conversation.type === CONVERSATION_TYPES.PLAYDATE && conversation.playdateId) {
      const playdateId = conversation.playdateId._id || conversation.playdateId;
      await playdateService.verifyPlaydateParticipant(playdateId, parentId);
    }
  }

  /**
   * Create the playdate group conversation, or sync its members with the host and the
   * currently accepted participants, then link it back to the playdate.
   * @private
   */
  async _upsertPlaydateConversation(playdate) {
    const memberIds = playdateService.getAcceptedParentIds(playdate);
    const conversation = await chatRepository.upsertPlaydateConversation(playdate._id, memberIds);

    if (playdate.chatConversationId?.toString() !== conversation._id.toString()) {
      await playdateService.updateChatConversationId(playdate._id, conversation._id);
    }

    return conversation;
  }

  /**
   * Get all conversations for a parent with unread count and latest message
   */
  async getUserConversations(parentOrUserId, filter = {}) {
    const parent = await this._resolveParent(parentOrUserId);
    const [conversations, blocks] = await Promise.all([
      chatRepository.findUserConversations(parent._id, filter),
      safetyService.findBlocksInvolving(parent._id),
    ]);
    return conversations.map((conv) => ({
      ...conv,
      _blockState: this._buildBlockState(conv, parent._id, blocks),
    }));
  }

  /**
   * Get a conversation by ID, verifying parent membership.
   * Playdate conversations include the playdate host & participants for the event panel.
   * @param {Object|string} parentOrUserId
   * @param {string} conversationId
   * @param {Object} [options]
   * @param {boolean} [options.withPlaydateDetails=true]
   */
  async getConversationById(parentOrUserId, conversationId, { withPlaydateDetails = true } = {}) {
    const parent = await this._resolveParent(parentOrUserId);
    const [conversation, blocks] = await Promise.all([
      chatRepository.findConversationById(conversationId, { withPlaydateDetails }),
      safetyService.findBlocksInvolving(parent._id),
    ]);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
    }

    await this._assertConversationAccess(conversation, parent._id);
    return { ...conversation, _blockState: this._buildBlockState(conversation, parent._id, blocks) };
  }

  /**
   * Block state of a conversation as seen by the given parent.
   * Group (playdate) chats only list the members the caller blocked: who blocked the caller is
   * never revealed. A direct chat reports a block by the partner because sending is refused.
   * @param {Object} conversation - Participants and playdateId populated or not
   * @param {string|ObjectId} parentId
   * @param {Array<{ blockerId: ObjectId, blockedId: ObjectId }>} blocks - Blocks involving the parent
   * @returns {{ blockedByMeIds: string[], isBlockedByPartner: boolean }}
   * @private
   */
  _buildBlockState(conversation, parentId, blocks) {
    const me = parentId.toString();
    const blockedByMe = new Set();
    const blockedMe = new Set();
    blocks.forEach((b) => {
      const blockerId = b.blockerId.toString();
      const blockedId = b.blockedId.toString();
      if (blockerId === me) blockedByMe.add(blockedId);
      else if (blockedId === me) blockedMe.add(blockerId);
    });

    const idOf = (ref) => (ref?._id || ref)?.toString();
    const memberIds = new Set((conversation.participants || []).map(idOf));
    const playdate = conversation.playdateId;
    if (playdate && typeof playdate === 'object' && playdate.hostParentId) {
      memberIds.add(idOf(playdate.hostParentId));
      (playdate.participants || []).forEach((p) => memberIds.add(idOf(p.parentId)));
    }
    memberIds.delete(me);
    memberIds.delete(undefined);

    const others = [...memberIds];
    return {
      blockedByMeIds: others.filter((id) => blockedByMe.has(id)),
      isBlockedByPartner:
        conversation.type === CONVERSATION_TYPES.DIRECT && others.some((id) => blockedMe.has(id)),
    };
  }

  /**
   * Get or create a Playdate group conversation.
   * Only the host and parents with 'accepted' status can open it.
   * @param {Object|string} parentOrUserId
   * @param {string} playdateId
   */
  async getOrCreatePlaydateConversation(parentOrUserId, playdateId) {
    const parent = await this._resolveParent(parentOrUserId);
    const playdate = await playdateService.verifyPlaydateParticipant(playdateId, parent._id);
    return this._upsertPlaydateConversation(playdate);
  }

  /**
   * Create or refresh the group chat of a playdate without a caller check.
   * For the playdate flow: call it when a playdate is created and whenever a participant
   * accepts or declines, so the chat exists from creation and its members stay in sync.
   * @param {string} playdateId
   */
  async syncPlaydateConversation(playdateId) {
    const playdate = await playdateService.getPlaydateById(playdateId);
    return this._upsertPlaydateConversation(playdate);
  }

  /**
   * Direct messages need an accepted connection unless both parents accept messages from everyone
   * (messagePrivacy). Checked when the conversation is opened and on every message, so removing
   * the connection also stops an existing direct chat.
   * @private
   */
  async _assertDirectMessagingAllowed(currentParent, targetParent) {
    const targetPrivacy = targetParent.privacySettings?.messagePrivacy || MESSAGE_PRIVACY.CONNECTED_ONLY;
    const currentPrivacy = currentParent.privacySettings?.messagePrivacy || MESSAGE_PRIVACY.CONNECTED_ONLY;

    if (targetPrivacy === MESSAGE_PRIVACY.CONNECTED_ONLY || currentPrivacy === MESSAGE_PRIVACY.CONNECTED_ONLY) {
      const isConnected = await connectionService.areConnected(currentParent._id, targetParent._id);
      if (!isConnected) {
        throw new AppError('You can only message parents you are connected with', 403, 'CONNECTION_REQUIRED');
      }
    }
  }

  /**
   * Get or create a 1-on-1 direct conversation with another parent
   */
  async getOrCreateDirectConversation(parentOrUserId, targetParentId) {
    const currentParent = await this._resolveParent(parentOrUserId);

    if (currentParent._id.toString() === targetParentId.toString()) {
      throw new AppError('Cannot create conversation with yourself', 400, 'SELF_CHAT_NOT_ALLOWED');
    }

    const targetParent = await parentService.getParentById(targetParentId);
    if (!targetParent) {
      throw new AppError('Target parent profile not found', 404, 'TARGET_PARENT_NOT_FOUND');
    }

    // 1. Check if blocked in either direction
    const isBlocked = await safetyService.isBlocked(currentParent._id, targetParent._id);
    if (isBlocked) {
      throw new AppError('Cannot start a conversation because one of the users has blocked the other', 403, 'USER_BLOCKED');
    }

    // 2. Check messagePrivacy: connected_only and verify active connection
    await this._assertDirectMessagingAllowed(currentParent, targetParent);

    // Check if direct conversation already exists
    const existing = await chatRepository.findDirectConversation(currentParent._id, targetParent._id);
    if (existing) {
      return existing;
    }

    const pairKey = [currentParent._id.toString(), targetParent._id.toString()].sort().join('_');

    try {
      // Create new conversation
      return await chatRepository.createConversation({
        type: CONVERSATION_TYPES.DIRECT,
        participants: [currentParent._id, targetParent._id],
        pairKey,
        unreadCounts: {
          [currentParent._id.toString()]: 0,
          [targetParent._id.toString()]: 0,
        },
        isActive: true,
      });
    } catch (error) {
      // Handle race condition: if concurrent request created it simultaneously
      if (error.code === 11000 || error.message?.includes('duplicate key') || error.message?.includes('E11000')) {
        const concurrentConv = await chatRepository.findDirectConversation(currentParent._id, targetParent._id);
        if (concurrentConv) {
          return concurrentConv;
        }
      }
      throw error;
    }
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(parentOrUserId, conversationId, options = {}) {
    // Ensure parent has access to conversation
    await this.getConversationById(parentOrUserId, conversationId, { withPlaydateDetails: false });
    return chatRepository.findMessages(conversationId, options);
  }

  /**
   * Sender of a message and the members of its conversation. Used by the safety module to check
   * that a reported message belongs to the reported parent and was visible to the reporter.
   * @param {string|ObjectId} messageId
   * @returns {Promise<{ senderId: string, participantIds: string[] }|null>} null when not found
   */
  async getMessageWithParticipants(messageId) {
    const message = await chatRepository.findMessageById(messageId);
    if (!message) return null;
    const conversation = await chatRepository.findConversationDocById(message.conversationId);
    return {
      senderId: message.senderId.toString(),
      participantIds: (conversation?.participants || []).map((id) => id.toString()),
    };
  }

  /**
   * Send a new message into a conversation
   */
  async sendMessage(parentOrUserId, conversationId, { content, type, mediaUrl }) {
    const parent = await this._resolveParent(parentOrUserId);
    const conversation = await chatRepository.findConversationDocById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
    }

    await this._assertConversationAccess(conversation, parent._id);

    // Determine recipient IDs
    const recipientIds = conversation.participants
      .filter((p) => p.toString() !== parent._id.toString())
      .map((p) => p.toString());

    // Check if blocked in either direction (direct conversations only). In a playdate group chat
    // a parent who blocked a member is asked on the client whether to stay or leave the playdate.
    if (conversation.type === CONVERSATION_TYPES.DIRECT) {
      const isBlocked = await safetyService.isBlockedWithAny(parent._id, recipientIds);
      if (isBlocked) {
        throw new AppError('Cannot send messages because one of the users has blocked the other', 403, 'USER_BLOCKED');
      }
    }

    // A direct chat continues only while the parents may still message each other (connection removed)
    if (conversation.type === CONVERSATION_TYPES.DIRECT && recipientIds.length === 1) {
      const recipient = await parentService.getParentById(recipientIds[0]);
      if (recipient) await this._assertDirectMessagingAllowed(parent, recipient);
    }

    // Strict validation of payload for both HTTP and Socket
    let finalType = type || MESSAGE_TYPES.TEXT;
    const allowedUserTypes = [MESSAGE_TYPES.TEXT, MESSAGE_TYPES.IMAGE, MESSAGE_TYPES.EMOJI];
    if (!allowedUserTypes.includes(finalType)) {
      throw new AppError('Invalid message type', 400, 'INVALID_MESSAGE_TYPE');
    }

    // Socket payloads bypass express-validator, so check primitive types here
    if ((content !== undefined && content !== null && typeof content !== 'string') ||
      (mediaUrl !== undefined && mediaUrl !== null && typeof mediaUrl !== 'string')) {
      throw new AppError('Invalid message payload', 400, 'INVALID_MESSAGE_PAYLOAD');
    }

    let finalContent = (content || '').trim();
    if (finalContent.length > 5000) {
      throw new AppError('Message content cannot exceed 5000 characters', 400, 'MESSAGE_TOO_LONG');
    }

    // Only accept images uploaded through our own Cloud Storage (POST /chat/upload)
    if (mediaUrl && !storageAdapter.isOwnedMediaUrl(mediaUrl)) {
      throw new AppError('Invalid media URL', 400, 'INVALID_MEDIA_URL');
    }

    if (mediaUrl && (!finalContent || finalType === MESSAGE_TYPES.IMAGE)) {
      finalType = MESSAGE_TYPES.IMAGE;
      if (!finalContent) finalContent = '[Hình ảnh]';
    }

    if (!finalContent && !mediaUrl) {
      throw new AppError('Message cannot be empty', 400, 'MESSAGE_EMPTY');
    }

    // Create message document
    const message = await chatRepository.createMessage({
      conversationId: conversation._id,
      senderId: parent._id,
      type: finalType,
      content: finalContent,
      mediaUrl: mediaUrl || null,
      readBy: [
        {
          parentId: parent._id,
          readAt: new Date(),
        },
      ],
    });

    // Update conversation lastMessage & unread counters
    const updatedConversation = await chatRepository.updateLastMessage(
      conversation._id,
      message,
      recipientIds
    );

    return {
      message,
      conversation: updatedConversation,
      senderParent: parent,
    };
  }

  /**
   * Mark messages as read by a parent and reset unread counter
   */
  async markAsRead(parentOrUserId, conversationId) {
    const parent = await this._resolveParent(parentOrUserId);

    // Verify access
    await this.getConversationById(parent, conversationId, { withPlaydateDetails: false });

    await chatRepository.markMessagesAsRead(conversationId, parent._id);
    await chatRepository.resetUnreadCount(conversationId, parent._id);

    return {
      conversationId,
      parentId: parent._id.toString(),
      readAt: new Date(),
    };
  }

  /**
   * Upload image attachment using Cloud Storage adapter
   */
  async uploadAttachment(file) {
    if (!file) {
      throw new AppError('No image file uploaded', 400, 'FILE_REQUIRED');
    }
    const result = await storageAdapter.uploadImage(file.buffer, {
      folder: 'buddylink/chat',
      mimetype: file.mimetype,
    });
    return {
      mediaUrl: result.url,
      publicId: result.publicId,
    };
  }
}

export const chatService = new ChatService();
export default chatService;
