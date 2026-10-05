import chatService from '../modules/chat/chat.service.js';
import ChatDTO from '../modules/chat/chat.dto.js';
import { SOCKET_EVENTS } from '../modules/chat/chat.constants.js';
import { broadcastNewMessage, broadcastReadStatus } from './chat.broadcast.js';
import logger from '../shared/logger/index.js';
import AppError from '../shared/exceptions/AppError.js';

/**
 * Sanitize error messages sent to client, shielding internal DB/runtime details
 * @param {Error} error
 * @param {string} defaultMessage
 * @returns {string}
 */
const sanitizeErrorMessage = (error, defaultMessage = 'Something went wrong while processing the request') => {
  if (!error) return defaultMessage;
  if (error instanceof AppError || error.isOperational) {
    return error.message;
  }
  return defaultMessage;
};

/**
 * Register chat-related Socket.IO event handlers
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export const registerChatSocket = (io, socket) => {
  // Chat is parent-only. Pass the parent resolved at handshake so services do not
  // have to guess whether an id string is a userId or a parentId.
  const getCallerParent = () => {
    if (!socket.parent) {
      throw new AppError('Only parent accounts can use chat', 403, 'PARENT_REQUIRED');
    }
    return socket.parent;
  };

  // 1. Join Chat Room
  socket.on(SOCKET_EVENTS.JOIN_CHAT, async (payload, callback) => {
    try {
      const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
      if (!conversationId) return;

      // Verify participant access to the conversation before joining
      await chatService.getConversationById(getCallerParent(), conversationId);

      socket.join(conversationId);
      logger.info(`Socket [${socket.id}] joined chat room: ${conversationId}`);

      if (typeof callback === 'function') {
        callback({ success: true, conversationId });
      }
    } catch (error) {
      logger.warn(`Socket [${socket.id}] join_chat rejected: ${error.message}`);
      const clientMessage = sanitizeErrorMessage(error, 'Unable to join the conversation');
      if (typeof callback === 'function') {
        callback({ success: false, error: clientMessage, code: error.code || 'JOIN_REJECTED' });
      } else {
        socket.emit(SOCKET_EVENTS.ERROR, {
          event: SOCKET_EVENTS.JOIN_CHAT,
          message: clientMessage,
          code: error.code || 'JOIN_REJECTED',
        });
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
      // Client-generated id of the optimistic message; echoed back to the sender only, never stored
      const tempId = typeof payload?.tempId === 'string' ? payload.tempId.slice(0, 64) : undefined;
      const parent = getCallerParent();

      if (!conversationId) {
        throw new AppError('conversationId is required', 400, 'BAD_REQUEST');
      }

      const result = await chatService.sendMessage(parent, conversationId, {
        content,
        type,
        mediaUrl,
      });

      // Broadcast personalized DTOs to all participants in real time
      broadcastNewMessage(io, result, { tempId });

      const senderMsgDto = {
        ...ChatDTO.toMessageResponse(result.message, socket.parentId),
        ...(tempId ? { tempId } : {}),
      };
      if (typeof callback === 'function') {
        callback({ success: true, data: senderMsgDto });
      }
    } catch (error) {
      logger.error(`[Socket Error] send_message failed: ${error.message}`);
      const clientMessage = sanitizeErrorMessage(error, 'Unable to send the message. Please try again later.');
      if (typeof callback === 'function') {
        callback({ success: false, error: clientMessage, code: error.code || 'INTERNAL_ERROR' });
      } else {
        socket.emit(SOCKET_EVENTS.ERROR, {
          event: SOCKET_EVENTS.SEND_MESSAGE,
          message: clientMessage,
          code: error.code || 'INTERNAL_ERROR',
        });
      }
    }
  });

  // 4. Typing Indicator (verifies membership before broadcasting)
  socket.on(SOCKET_EVENTS.TYPING, async (payload) => {
    try {
      const { conversationId, isTyping } = payload || {};
      if (!conversationId) return;

      // Verify participant access to the conversation
      if (!socket.rooms.has(conversationId)) {
        await chatService.getConversationById(getCallerParent(), conversationId);
        socket.join(conversationId);
      }

      // Broadcast to others in the room
      socket.to(conversationId).emit(SOCKET_EVENTS.USER_TYPING, {
        conversationId,
        parentId: socket.parentId,
        isTyping: Boolean(isTyping),
      });
    } catch (error) {
      logger.warn(`Rejected typing event from socket [${socket.id}]: ${error.message}`);
    }
  });

  // 5. Read Status
  socket.on(SOCKET_EVENTS.READ_STATUS, async (payload) => {
    try {
      const conversationId = typeof payload === 'string' ? payload : payload?.conversationId;
      if (!conversationId) return;

      const result = await chatService.markAsRead(getCallerParent(), conversationId);

      // Notify conversation room and participants that messages have been read
      broadcastReadStatus(io, conversationId, result);
    } catch (error) {
      logger.error(`[Socket Error] read_status failed: ${error.message}`);
    }
  });
};

export default registerChatSocket;

