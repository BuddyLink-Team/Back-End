import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';

export const RATING_EVENTS = Object.freeze({
  CREATED: 'rating.created',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a rating-feedback event.
 * @param {string} event - One of RATING_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onRatingEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a rating-feedback event. Handlers run safely without breaking caller.
 * @param {string} event
 * @param {Object} payload
 */
export const emitRatingEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[RatingEvents] ${event} handler failed: ${result.reason?.message}`));
};

export default {
  RATING_EVENTS,
  onRatingEvent,
  emitRatingEvent,
};

