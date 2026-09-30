import chatService from './chat.service.js';
import ChatDTO from './chat.dto.js';
import { successResponse } from '../../shared/response/index.js';
import parentService from '../parent/parent.service.js';

class ChatController {
  async getConversations(req, res, next) {
    try {
      const parent = await parentService.getParentByUserId(req.userId);
      const conversations = await chatService.getUserConversations(req.userId, req.query);
      const data = ChatDTO.toConversationListResponse(conversations, parent?._id);

      return successResponse(res, data, 'Conversations retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getConversation(req, res, next) {
    try {
      const parent = await parentService.getParentByUserId(req.userId);
      const conversation = await chatService.getConversationById(req.userId, req.params.conversationId);
      const data = ChatDTO.toConversationResponse(conversation, parent?._id);

      return successResponse(res, data, 'Conversation details retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getOrCreateDirectConversation(req, res, next) {
    try {
      const { targetParentId } = req.body;
      const parent = await parentService.getParentByUserId(req.userId);
      const conversation = await chatService.getOrCreateDirectConversation(req.userId, targetParentId);
      const data = ChatDTO.toConversationResponse(conversation, parent?._id);

      return successResponse(res, data, 'Direct conversation ready', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getMessages(req, res, next) {
    try {
      const parent = await parentService.getParentByUserId(req.userId);
      const messages = await chatService.getMessages(req.userId, req.params.conversationId, req.query);
      const data = ChatDTO.toMessageListResponse(messages, parent?._id);

      return successResponse(res, data, 'Messages retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async sendMessage(req, res, next) {
    try {
      const parent = await parentService.getParentByUserId(req.userId);
      const { content, type, mediaUrl } = req.body;
      const result = await chatService.sendMessage(req.userId, req.params.conversationId, {
        content,
        type,
        mediaUrl,
      });

      const messageDto = ChatDTO.toMessageResponse(result.message, parent?._id);
      return successResponse(res, messageDto, 'Message sent successfully', 201);
    } catch (error) {
      return next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const result = await chatService.markAsRead(req.userId, req.params.conversationId);
      return successResponse(res, result, 'Conversation marked as read', 200);
    } catch (error) {
      return next(error);
    }
  }

  async uploadAttachment(req, res, next) {
    try {
      const result = await chatService.uploadAttachment(req.file);
      return successResponse(res, result, 'Attachment uploaded successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export const chatController = new ChatController();
export default chatController;
