import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';

/**
 * Connection domain events. Other modules subscribe here instead of being imported by the
 * connection service (keeps the dependency one-way, e.g. gamification -> connection).
 */
export const CONNECTION_EVENTS = Object.freeze({
  // A connection request became accepted
  ACCEPTED: 'connection.accepted',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a connection event.
 * @param {string} event - One of CONNECTION_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onConnectionEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a connection event and wait for every handler. A failing handler is logged and never
 * breaks the connection action that emitted the event.
 * @param {string} event
 * @param {Object} payload
 */
export const emitConnectionEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[ConnectionEvents] ${event} handler failed: ${result.reason?.message}`));
};
