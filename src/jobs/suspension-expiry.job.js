import cron from 'node-cron';
import env from '../config/env.js';
import logger from '../shared/logger/index.js';
import userService from '../modules/user/user.service.js';
import { emitSystemEvent, SYSTEM_EVENTS } from '../shared/events/system.events.js';

// Every 15 minutes
const SCHEDULE = '*/15 * * * *';

/**
 * Reactivate the accounts whose suspension has ended.
 * (Signing in also lifts it right away in userService.liftExpiredSuspension; this job keeps the stored
 * status accurate for admin screens and Discovery when the parent does not come back.)
 * @returns {import('node-cron').ScheduledTask}
 */
export const startSuspensionExpiryJob = () =>
  cron.schedule(
    SCHEDULE,
    async () => {
      try {
        await userService.liftEndedSuspensions();
      } catch (error) {
        logger.error(`[SuspensionExpiryJob] Failed: ${error.message}`);
        void emitSystemEvent(SYSTEM_EVENTS.CRON_JOB_FAILED, {
          jobName: 'SuspensionExpiryJob',
          error: error.message,
        });
      }
    },
    { timezone: env.APP_TIMEZONE },
  );

export default startSuspensionExpiryJob;
