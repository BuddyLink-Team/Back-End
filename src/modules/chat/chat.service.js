import chatRepository from './chat.repository.js';
import parentService from '../parent/parent.service.js';
import storageAdapter from '../../integrations/storage/storage.adapter.js';
import AppError from '../../shared/exceptions/AppError.js';
import Block from '../safety/block.model.js';
import Connection from '../connection/connection.model.js';
import { CONNECTION_STATUS } from '../connection/connection.constants.js';
import { MESSAGE_PRIVACY } from '../parent/parent.constants.js';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from './chat.constants.js';

class ChatService {
  /**
   * Helper to resolve parent profile from parent object, userId or direct parentId
   * @private
   */
  async _resolveParent(parentOrUserId) {
    if (!parentOrUserId) {
      throw new AppError('User or parent ID is required', 400, 'ID_REQUIRED');
    }

    // If already a parent object/doc (e.g. passed from controller)
    if (typeof parentOrUserId === 'object' && (parentOrUserId._id || parentOrUserId.id)) {
      return parentOrUserId;
    }

    // Try finding by userId first
    let parent = await parentService.getParentByUserId(parentOrUserId);
    if (!parent) {
      // Try finding by parentId
      parent = await parentService.getParentById(parentOrUserId);
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

    // 1. Check if blocked in either direction
    const isBlocked = await Block.findOne({
      $or: [
        { blockerId: currentParent._id, blockedId: targetParent._id },
        { blockerId: targetParent._id, blockedId: currentParent._id },
      ],
    });
    if (isBlocked) {
      throw new AppError('Không thể tạo cuộc trò chuyện vì người dùng đã bị chặn', 403, 'USER_BLOCKED');
    }

    // 2. Check messagePrivacy: connected_only and verify active connection
    const targetPrivacy = targetParent.privacySettings?.messagePrivacy || MESSAGE_PRIVACY.CONNECTED_ONLY;
    const currentPrivacy = currentParent.privacySettings?.messagePrivacy || MESSAGE_PRIVACY.CONNECTED_ONLY;

    if (targetPrivacy === MESSAGE_PRIVACY.CONNECTED_ONLY || currentPrivacy === MESSAGE_PRIVACY.CONNECTED_ONLY) {
      const isConnected = await Connection.findOne({
        parents: { $all: [currentParent._id, targetParent._id] },
        status: CONNECTION_STATUS.ACCEPTED,
      });

      if (!isConnected) {
        throw new AppError('Chỉ có thể nhắn tin với người dùng đã kết nối', 403, 'CONNECTION_REQUIRED');
      }
    }

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

    // Determine recipient IDs
    const recipientIds = conversation.participants
      .filter((p) => p.toString() !== parent._id.toString())
      .map((p) => p.toString());

    // Check if blocked in either direction
    if (recipientIds.length > 0) {
      const isBlocked = await Block.findOne({
        $or: [
          { blockerId: parent._id, blockedId: { $in: recipientIds } },
          { blockerId: { $in: recipientIds }, blockedId: parent._id },
        ],
      });
      if (isBlocked) {
        throw new AppError('Không thể gửi tin nhắn vì người dùng đã bị chặn', 403, 'USER_BLOCKED');
      }
    }

    // Strict validation of payload for both HTTP and Socket
    let finalType = type || MESSAGE_TYPES.TEXT;
    const allowedUserTypes = [MESSAGE_TYPES.TEXT, MESSAGE_TYPES.IMAGE, MESSAGE_TYPES.EMOJI];
    if (!allowedUserTypes.includes(finalType)) {
      throw new AppError('Loại tin nhắn không hợp lệ', 400, 'INVALID_MESSAGE_TYPE');
    }

    let finalContent = (content || '').trim();
    if (finalContent.length > 5000) {
      throw new AppError('Nội dung tin nhắn không được vượt quá 5000 ký tự', 400, 'MESSAGE_TOO_LONG');
    }

    if (mediaUrl) {
      if (typeof mediaUrl !== 'string' || mediaUrl.length > 2048 || !/^https?:\/\/.+/i.test(mediaUrl.trim())) {
        throw new AppError('Đường dẫn hình ảnh không hợp lệ', 400, 'INVALID_MEDIA_URL');
      }
    }

    if (mediaUrl && (!finalContent || finalType === MESSAGE_TYPES.IMAGE)) {
      finalType = MESSAGE_TYPES.IMAGE;
      if (!finalContent) finalContent = '[Hình ảnh]';
    }

    if (!finalContent && !mediaUrl) {
      throw new AppError('Tin nhắn không được để trống', 400, 'MESSAGE_EMPTY');
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
