import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';

/**
 * User domain events.
 */
export const USER_EVENTS = Object.freeze({
  USER_SIGNED_UP: 'user.signed_up',
  USER_STATUS_CHANGED: 'user.status_changed',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a user event.
 * @param {string} event - One of USER_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onUserEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a user event and wait for handlers safely.
 * @param {string} event
 * @param {Object} payload
 */
export const emitUserEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[UserEvents] ${event} handler failed: ${result.reason?.message}`));
};
