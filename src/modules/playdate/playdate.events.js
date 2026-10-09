import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';

/**
 * Playdate domain events. Other modules subscribe here instead of being imported by the
 * playdate service (keeps the dependency one-way, e.g. chat -> playdate).
 */
export const PLAYDATE_EVENTS = Object.freeze({
  // Host or accepted participants changed (created, RSVP accepted/declined)
  MEMBERS_CHANGED: 'playdate.membersChanged',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a playdate event.
 * @param {string} event - One of PLAYDATE_EVENTS
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onPlaydateEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a playdate event and wait for every handler. A failing handler is logged and never
 * breaks the playdate action that emitted the event.
 * @param {string} event
 * @param {Object} payload
 */
export const emitPlaydateEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[PlaydateEvents] ${event} handler failed: ${result.reason?.message}`));
};
