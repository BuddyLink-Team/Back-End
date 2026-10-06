import chatService from './chat.service.js';
import ChatDTO from './chat.dto.js';
import { successResponse } from '../../shared/response/index.js';
import { getIO } from '../../config/socket.js';
import { broadcastNewMessage, broadcastReadStatus } from '../../sockets/chat.broadcast.js';

class ChatController {
  async getConversations(req, res, next) {
    try {
      const parent = await chatService.getCallerParent(req.userId);
      const conversations = await chatService.getUserConversations(parent, req.query);
      const data = ChatDTO.toConversationListResponse(conversations, parent._id);

      return successResponse(res, data, 'Conversations retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getConversation(req, res, next) {
    try {
      const parent = await chatService.getCallerParent(req.userId);
      const conversation = await chatService.getConversationById(parent, req.params.conversationId);
      const data = ChatDTO.toConversationResponse(conversation, parent._id);

      return successResponse(res, data, 'Conversation details retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getOrCreateDirectConversation(req, res, next) {
    try {
      const parent = await chatService.getCallerParent(req.userId);
      const conversation = await chatService.getOrCreateDirectConversation(parent, req.body.targetParentId);
      const data = ChatDTO.toConversationResponse(conversation, parent._id);

      return successResponse(res, data, 'Direct conversation ready', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getOrCreatePlaydateConversation(req, res, next) {
    try {
      const parent = await chatService.getCallerParent(req.userId);
      const conversation = await chatService.getOrCreatePlaydateConversation(parent, req.params.playdateId);
      const data = ChatDTO.toConversationResponse(conversation, parent._id);

      return successResponse(res, data, 'Playdate conversation ready', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getMessages(req, res, next) {
    try {
      const parent = await chatService.getCallerParent(req.userId);
      const messages = await chatService.getMessages(parent, req.params.conversationId, req.query);
      const data = ChatDTO.toMessageListResponse(messages, parent._id);

      return successResponse(res, data, 'Messages retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async sendMessage(req, res, next) {
    try {
      const parent = await chatService.getCallerParent(req.userId);
      const { content, type, mediaUrl } = req.body;
      const result = await chatService.sendMessage(parent, req.params.conversationId, {
        content,
        type,
        mediaUrl,
      });

      // Broadcast real-time message via socket to all participants
      const io = getIO();
      if (io) {
        broadcastNewMessage(io, result);
      }

      const messageDto = ChatDTO.toMessageResponse(result.message, parent._id);
      return successResponse(res, messageDto, 'Message sent successfully', 201);
    } catch (error) {
      return next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const result = await chatService.markAsRead(req.userId, req.params.conversationId);

      // Broadcast read status via socket
      const io = getIO();
      if (io) {
        broadcastReadStatus(io, req.params.conversationId, result);
      }

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
