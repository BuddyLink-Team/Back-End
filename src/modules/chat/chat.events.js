import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';
import { getIO } from '../../config/socket.js';
import { broadcastNewMessage } from '../../sockets/chat.broadcast.js';

export const CHAT_EVENTS = Object.freeze({
  // A message posted by the system (e.g. the 24h reminder in a playdate group chat)
  // Payload: { message, conversation }
  MESSAGE_CREATED: 'chat.messageCreated',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a chat domain event.
 * @param {string} event - One of CHAT_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onChatEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a chat event and wait for all handlers.
 * @param {string} event
 * @param {Object} payload
 */
export const emitChatEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[ChatEvents] ${event} handler failed: ${result.reason?.message}`));
};

let isRegistered = false;

/**
 * Realtime reactions to chat events (socket broadcasts). Cross-module triggers live in chat.listener.js,
 * so this file never imports the chat service (the service imports this file).
 */
export const registerChatRealtimeListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  onChatEvent(CHAT_EVENTS.MESSAGE_CREATED, ({ message, conversation }) => {
    const io = getIO();
    if (io) broadcastNewMessage(io, { message, conversation });
  });
};

export default registerChatRealtimeListeners;
