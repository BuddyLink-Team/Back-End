import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';
import chatService from './chat.service.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';

export const CHAT_EVENTS = Object.freeze({
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
 * Chat reactions to other modules' events. Registered once at app startup.
 */
export const registerChatEventListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  // Keep the playdate group chat members = host + accepted participants
  onPlaydateEvent(PLAYDATE_EVENTS.MEMBERS_CHANGED, ({ playdateId }) =>
    chatService.syncPlaydateConversation(playdateId),
  );
};

export default registerChatEventListeners;
