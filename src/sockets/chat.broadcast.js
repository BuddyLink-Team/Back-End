import ChatDTO from '../modules/chat/chat.dto.js';
import { SOCKET_EVENTS } from '../modules/chat/chat.constants.js';
import logger from '../shared/logger/index.js';

/**
 * Broadcast newly sent message and updated conversation to all participants
 * Emits personalized DTOs to each participant's personal room
 */
export const broadcastNewMessage = (io, result) => {
  if (!io || !result || !result.message || !result.conversation) return;

  const conversation = result.conversation;
  const message = result.message;
  const conversationId = conversation._id?.toString() || conversation.id;
  const participants = conversation.participants || [];

  try {
    for (const p of participants) {
      const pId = p.id || p._id?.toString() || p.toString();
      const personalizedMsgDto = ChatDTO.toMessageResponse(message, pId);
      const personalizedConvDto = ChatDTO.toConversationResponse(conversation, pId);

      // 1. Emit to participant personal room (reaches all open tabs/screens of this user)
      io.to(`parent:${pId}`).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, personalizedMsgDto);
      io.to(`parent:${pId}`).emit(SOCKET_EVENTS.CONVERSATION_UPDATED, personalizedConvDto);
    }

    // 2. Also emit to conversation room
    io.to(conversationId).emit(SOCKET_EVENTS.CONVERSATION_UPDATED, ChatDTO.toConversationResponse(conversation, null));
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
