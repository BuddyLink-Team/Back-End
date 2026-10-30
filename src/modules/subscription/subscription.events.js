import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';

/**
 * Subscription & Payment domain events.
 */
export const SUBSCRIPTION_EVENTS = Object.freeze({
  PAYMENT_SUCCEEDED: 'subscription.payment_succeeded',
  PAYMENT_FAILED: 'subscription.payment_failed',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_EXPIRED: 'subscription.expired',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a subscription event.
 * @param {string} event - One of SUBSCRIPTION_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onSubscriptionEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a subscription event and wait for handlers safely.
 * @param {string} event
 * @param {Object} payload
 */
export const emitSubscriptionEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[SubscriptionEvents] ${event} handler failed: ${result.reason?.message}`));
};
