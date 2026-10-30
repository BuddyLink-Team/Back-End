import cron from 'node-cron';
import env from '../config/env.js';
import logger from '../shared/logger/index.js';
import playdateService from '../modules/playdate/playdate.service.js';
import { PLAYDATE_REMINDER } from '../modules/playdate/playdate.constants.js';
import { emitSystemEvent, SYSTEM_EVENTS } from '../shared/events/system.events.js';

// Every 15 minutes (business timezone)
const SCHEDULE = `*/${PLAYDATE_REMINDER.JOB_INTERVAL_MINUTES} * * * *`;

let isRunning = false;

/**
 * Send the playdate reminders that are due (24h and 1h before the start).
 * Skipped when a previous run is still in progress; each reminder is claimed atomically,
 * so a reminder is never sent twice even across several instances.
 * @returns {Promise<void>}
 */
export const runPlaydateReminders = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    const { h24, h1 } = await playdateService.sendDueReminders();
    if (h24 || h1) {
      logger.info(`[PlaydateReminderJob] Sent ${h24} 24h and ${h1} 1h playdate reminders`);
    }
  } catch (error) {
    logger.error(`[PlaydateReminderJob] Failed: ${error.message}`);
    void emitSystemEvent(SYSTEM_EVENTS.CRON_JOB_FAILED, { jobName: 'PlaydateReminderJob', error: error.message });
  } finally {
    isRunning = false;
  }
};

/**
 * @returns {import('node-cron').ScheduledTask}
 */
export const startPlaydateReminderJob = () =>
  cron.schedule(SCHEDULE, runPlaydateReminders, { timezone: env.APP_TIMEZONE });

export default startPlaydateReminderJob;
