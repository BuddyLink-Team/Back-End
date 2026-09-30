import chatService from '../modules/chat/chat.service.js';
import ChatDTO from '../modules/chat/chat.dto.js';
import { SOCKET_EVENTS } from '../modules/chat/chat.constants.js';
import logger from '../shared/logger/index.js';

/**
 * Register chat-related Socket.IO event handlers
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export const registerChatSocket = (io, socket) => {
  const getCallerId = () => socket.parentId || socket.userId;

  // 1. Join Chat Room (TASK-BE-11: Enforce Playdate accepted participant permission)
  socket.on(SOCKET_EVENTS.JOIN_CHAT, async (payload, callback) => {
    try {
      const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
      const callerId = getCallerId();
      if (!conversationId) return;

      if (!callerId) {
        throw new Error('Unauthorized socket action: user not identified');
      }

      // TASK-BE-11: Verify user permission to access conversation
      // (If it's a Playdate chat, this strictly checks that caller has 'accepted' status or is host)
      await chatService.getConversationById(callerId, conversationId);

      socket.join(conversationId);
      logger.info(`Socket [${socket.id}] (caller: ${callerId}) joined chat room: ${conversationId}`);

      if (typeof callback === 'function') {
        callback({ success: true, conversationId });
      }
    } catch (error) {
      logger.warn(`[Socket Auth Warning] join_chat forbidden: ${error.message}`);
      socket.emit(SOCKET_EVENTS.ERROR || 'error', {
        event: SOCKET_EVENTS.JOIN_CHAT,
        code: error.code || 'FORBIDDEN_PLAYDATE_CHAT_ACCESS',
        message: error.message,
      });
      if (typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });

  // 2. Leave Chat Room
  socket.on(SOCKET_EVENTS.LEAVE_CHAT, (payload) => {
    const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
    if (!conversationId) return;

    socket.leave(conversationId);
    logger.info(`Socket [${socket.id}] left chat room: ${conversationId}`);
  });

  // 3. Send Message
  socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (payload, callback) => {
    try {
      const { conversationId, content, type, mediaUrl } = payload || {};
      const callerId = getCallerId();

      if (!callerId) {
        throw new Error('Unauthorized socket action: user not identified');
      }

      if (!conversationId) {
        throw new Error('conversationId is required to send message');
      }

      const result = await chatService.sendMessage(callerId, conversationId, {
        content,
        type,
        mediaUrl,
      });

      const messageDto = ChatDTO.toMessageResponse(result.message, socket.parentId);
      const conversationDto = ChatDTO.toConversationResponse(result.conversation, socket.parentId);

      // Broadcast to all participants in the conversation room
      io.to(conversationId).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, messageDto);
      io.to(conversationId).emit(SOCKET_EVENTS.CONVERSATION_UPDATED, conversationDto);

      if (typeof callback === 'function') {
        callback({ success: true, data: messageDto });
      }
    } catch (error) {
      logger.error(`[Socket Error] send_message failed: ${error.message}`);
      if (typeof callback === 'function') {
        callback({ success: false, error: error.message });
      } else {
        socket.emit(SOCKET_EVENTS.ERROR, { event: SOCKET_EVENTS.SEND_MESSAGE, message: error.message });
      }
    }
  });

  // 4. Typing Indicator
  socket.on(SOCKET_EVENTS.TYPING, (payload) => {
    const { conversationId, isTyping } = payload || {};
    if (!conversationId) return;

    // Broadcast to others in the room
    socket.to(conversationId).emit(SOCKET_EVENTS.USER_TYPING, {
      conversationId,
      parentId: socket.parentId || socket.userId,
      isTyping: Boolean(isTyping),
    });
  });

  // 5. Read Status
  socket.on(SOCKET_EVENTS.READ_STATUS, async (payload) => {
    try {
      const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
      const callerId = getCallerId();
      if (!conversationId || !callerId) return;

      const result = await chatService.markAsRead(callerId, conversationId);

      // Notify others that messages have been read
      io.to(conversationId).emit(SOCKET_EVENTS.MESSAGE_READ, result);
    } catch (error) {
      logger.error(`[Socket Error] read_status failed: ${error.message}`);
    }
  });
};

export default registerChatSocket;
