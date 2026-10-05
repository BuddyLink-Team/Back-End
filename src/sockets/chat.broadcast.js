import ChatDTO from '../modules/chat/chat.dto.js';
import { SOCKET_EVENTS } from '../modules/chat/chat.constants.js';
import logger from '../shared/logger/index.js';

/**
 * Broadcast newly sent message and updated conversation to all participants
 * Emits personalized DTOs to each participant's personal room
 * @param {import('socket.io').Server} io
 * @param {{ message: Object, conversation: Object }} result
 * @param {Object} [options]
 * @param {string} [options.tempId] - Sender's optimistic message id, echoed to the sender only
 */
export const broadcastNewMessage = (io, result, { tempId } = {}) => {
  if (!io || !result || !result.message || !result.conversation) return;

  const conversation = result.conversation;
  const message = result.message;
  const participants = conversation.participants || [];
  const senderId = message.senderId?._id?.toString() || message.senderId?.toString();

  try {
    for (const p of participants) {
      const pId = p.id || p._id?.toString() || p.toString();
      const personalizedMsgDto = ChatDTO.toMessageResponse(message, pId);
      if (tempId && pId === senderId) {
        personalizedMsgDto.tempId = tempId;
      }
      const personalizedConvDto = ChatDTO.toConversationResponse(conversation, pId);

      // Emit to participant personal room (reaches all open tabs/screens of this user).
      // Do not also emit to the conversation room: a non-personalized DTO has no viewer,
      // so partner/unreadCount would be wrong and overwrite the personalized copy on clients.
      io.to(`parent:${pId}`).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, personalizedMsgDto);
      io.to(`parent:${pId}`).emit(SOCKET_EVENTS.CONVERSATION_UPDATED, personalizedConvDto);
    }
  } catch (err) {
    logger.error(`[ChatBroadcast] broadcastNewMessage error: ${err.message}`);
  }
};

/**
 * Broadcast message read status to conversation room and participants
 */
export const broadcastReadStatus = (io, conversationId, readResult) => {
  if (!io || !conversationId || !readResult) return;

  try {
    io.to(conversationId).emit(SOCKET_EVENTS.MESSAGE_READ, readResult);
  } catch (err) {
    logger.error(`[ChatBroadcast] broadcastReadStatus error: ${err.message}`);
  }
};

export default {
  broadcastNewMessage,
  broadcastReadStatus,
};
