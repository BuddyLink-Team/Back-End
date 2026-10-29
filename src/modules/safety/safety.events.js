import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';

/**
 * Safety domain events. Other modules subscribe here instead of being imported by the safety
 * service (keeps the dependency one-way, e.g. connection -> safety).
 */
export const SAFETY_EVENTS = Object.freeze({
  // A parent blocked another parent
  USER_BLOCKED: 'safety.user_blocked',
  // A new violation report was filed
  REPORT_CREATED: 'safety.report_created',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a safety event.
 * @param {string} event - One of SAFETY_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onSafetyEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a safety event and wait for every handler. Every handler runs even when another one
 * fails; failures are logged and returned so the emitter can tell the caller.
 * @param {string} event
 * @param {Object} payload
 * @returns {Promise<Error[]>} Errors of the failed handlers (empty when all succeeded)
 */
export const emitSafetyEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  errors.forEach((error) => logger.error(`[SafetyEvents] ${event} handler failed: ${error?.message}`));
  return errors;
};
