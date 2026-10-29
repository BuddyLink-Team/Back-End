import { EventEmitter } from 'node:events';
import logger from '../logger/index.js';

/**
 * System domain events (cron jobs, external webhook failures).
 */
export const SYSTEM_EVENTS = Object.freeze({
  CRON_JOB_FAILED: 'system.cron_job_failed',
  PAYMENT_GATEWAY_ERROR: 'system.payment_gateway_error',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a system event.
 * @param {string} event - One of SYSTEM_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onSystemEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a system event and wait for handlers safely.
 * @param {string} event
 * @param {Object} payload
 */
export const emitSystemEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[SystemEvents] ${event} handler failed: ${result.reason?.message}`));
};
