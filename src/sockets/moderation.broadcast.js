import { SOCKET_EVENTS } from '../modules/chat/chat.constants.js';
import logger from '../shared/logger/index.js';

/**
 * Tell a locked account why, then close its connections
 * @param {import('socket.io').Server|null} io - null in a process without the parent sockets
 * @param {string} userId
 * @param {{ reason: string, suspensionUntil: Date|null }} notice
 */
export const broadcastAccountLocked = (io, userId, notice) => {
  if (!io) return;

  try {
    const room = `user:${userId}`;
    io.to(room).emit(SOCKET_EVENTS.ACCOUNT_LOCKED, notice);
    io.in(room).disconnectSockets(true);
  } catch (err) {
    logger.error(`[ModerationBroadcast] broadcastAccountLocked error: ${err.message}`);
  }
};

/**
 * Replace a deleted message for every participant (personal rooms reach all their open tabs)
 * @param {import('socket.io').Server|null} io - null in a process without the parent sockets
 * @param {{ messageId: string, conversationId: string, content: string, participantIds: string[] }} notice
 */
export const broadcastMessageDeleted = (io, { messageId, conversationId, content, participantIds }) => {
  if (!io) return;

  try {
    participantIds.forEach((parentId) => {
      io.to(`parent:${parentId}`).emit(SOCKET_EVENTS.MESSAGE_DELETED, { messageId, conversationId, content });
    });
  } catch (err) {
    logger.error(`[ModerationBroadcast] broadcastMessageDeleted error: ${err.message}`);
  }
};

export default {
  broadcastAccountLocked,
  broadcastMessageDeleted,
};
