import chatRepository from './chat.repository.js';
import parentService from '../parent/parent.service.js';
import playdateService from '../playdate/playdate.service.js';
import storageAdapter from '../../integrations/storage/storage.adapter.js';
import AppError from '../../shared/exceptions/AppError.js';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from './chat.constants.js';

class ChatService {
  /**
   * Helper to resolve parent profile from userId or direct parentId
   * @private
   */
  async _resolveParent(userIdOrParentId) {
    if (!userIdOrParentId) {
      throw new AppError('User or parent ID is required', 400, 'ID_REQUIRED');
    }

    // Try finding by userId first
    let parent = await parentService.getParentByUserId(userIdOrParentId);
    if (!parent) {
      // Try finding by parentId
      parent = await parentService.getParentById(userIdOrParentId);
    }

    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    return parent;
  }

  /**
   * Get all conversations for a parent with unread count and latest message
   */
  async getUserConversations(userIdOrParentId, filter = {}) {
    const parent = await this._resolveParent(userIdOrParentId);
    return chatRepository.findUserConversations(parent._id, filter);
  }

  /**
   * Get a conversation by ID, verifying parent membership
   */
  async getConversationById(userIdOrParentId, conversationId) {
    const parent = await this._resolveParent(userIdOrParentId);
    const conversation = await chatRepository.findConversationById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
    }

    const isParticipant = (conversation.participants || []).some(
      (p) => (p._id?.toString() || p.toString()) === parent._id.toString()
    );

    if (!isParticipant) {
      throw new AppError('You do not have access to this conversation', 403, 'FORBIDDEN_CONVERSATION_ACCESS');
    }

    // TASK-BE-11: Enforce accepted status for playdate group chat
    if (conversation.type === CONVERSATION_TYPES.PLAYDATE && conversation.playdateId) {
      const pId = conversation.playdateId._id || conversation.playdateId;
      await playdateService.verifyPlaydateParticipant(pId, parent._id);
    }

    return conversation;
  }

  /**
   * TASK-BE-11: Get or create a Playdate group conversation
   * Enforces: ONLY parents with 'accepted' status (or host) can join
   * @param {string} userIdOrParentId
   * @param {string} playdateId
   */
  async getOrCreatePlaydateConversation(userIdOrParentId, playdateId) {
    const parent = await this._resolveParent(userIdOrParentId);

    // 1. Enforce accepted status
    const playdate = await playdateService.verifyPlaydateParticipant(playdateId, parent._id);
    const acceptedParentIds = playdateService.getAcceptedParentIds(playdate);

    // 2. Check if conversation already exists for this playdate
    const existing = await chatRepository.findConversationByPlaydateId(playdate._id);
    if (existing) {
      // Sync participants in case new participants were accepted
      const synced = await chatRepository.syncParticipants(existing._id, acceptedParentIds);
      return synced || existing;
    }

    // 3. Create new group conversation with all accepted parents
    const unreadMap = {};
    acceptedParentIds.forEach((id) => {
      unreadMap[id] = 0;
    });

    const conversation = await chatRepository.createConversation({
      type: CONVERSATION_TYPES.PLAYDATE,
      playdateId: playdate._id,
      participants: acceptedParentIds,
      unreadCounts: unreadMap,
      isActive: true,
    });

    // Link playdate back to conversation
    await playdateService.updateChatConversationId(playdate._id, conversation._id || conversation.id);

    return conversation;
  }

  /**
   * Get or create a 1-on-1 direct conversation with another parent
   */
  async getOrCreateDirectConversation(userIdOrParentId, targetParentId) {
    const currentParent = await this._resolveParent(userIdOrParentId);

    if (currentParent._id.toString() === targetParentId.toString()) {
      throw new AppError('Cannot create conversation with yourself', 400, 'SELF_CHAT_NOT_ALLOWED');
    }

    const targetParent = await parentService.getParentById(targetParentId);
    if (!targetParent) {
      throw new AppError('Target parent profile not found', 404, 'TARGET_PARENT_NOT_FOUND');
    }

    // Check if direct conversation already exists
    const existing = await chatRepository.findDirectConversation(currentParent._id, targetParent._id);
    if (existing) {
      return existing;
    }

    // Create new conversation
    return chatRepository.createConversation({
      type: CONVERSATION_TYPES.DIRECT,
      participants: [currentParent._id, targetParent._id],
      unreadCounts: {
        [currentParent._id.toString()]: 0,
        [targetParent._id.toString()]: 0,
      },
      isActive: true,
    });
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(userIdOrParentId, conversationId, options = {}) {
    // Ensure parent has access to conversation
    await this.getConversationById(userIdOrParentId, conversationId);
    return chatRepository.findMessages(conversationId, options);
  }

  /**
   * Send a new message into a conversation
   */
  async sendMessage(userIdOrParentId, conversationId, { content, type, mediaUrl }) {
    const parent = await this._resolveParent(userIdOrParentId);
    const conversation = await chatRepository.findConversationDocById(conversationId);

    if (!conversation) {
      throw new AppError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === parent._id.toString()
    );

    if (!isParticipant) {
      throw new AppError('You do not have access to this conversation', 403, 'FORBIDDEN_CONVERSATION_ACCESS');
    }

    // TASK-BE-11: Enforce accepted status for playdate group chat
    if (conversation.type === CONVERSATION_TYPES.PLAYDATE && conversation.playdateId) {
      await playdateService.verifyPlaydateParticipant(conversation.playdateId, parent._id);
    }

    let finalType = type || MESSAGE_TYPES.TEXT;
    let finalContent = (content || '').trim();

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

    // Determine recipient IDs to increment unread counter
    const recipientIds = conversation.participants
      .filter((p) => p.toString() !== parent._id.toString())
      .map((p) => p.toString());

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
  async markAsRead(userIdOrParentId, conversationId) {
    const parent = await this._resolveParent(userIdOrParentId);

    // Verify access
    await this.getConversationById(parent._id, conversationId);

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
    const result = await storageAdapter.uploadImage(file, 'buddylink/chat');
    return {
      mediaUrl: result.url,
      publicId: result.publicId,
    };
  }
}

export const chatService = new ChatService();
export default chatService;
