import cron from 'node-cron';
import env from '../config/env.js';
import logger from '../shared/logger/index.js';
import playdateService from '../modules/playdate/playdate.service.js';

// Every day at 00:00 (business timezone)
const SCHEDULE = '0 0 * * *';

/**
 * Close the upcoming playdates of past days: completed when someone accepted, cancelled otherwise.
 * Hosts can still complete a playdate themselves as soon as it starts.
 * @returns {Promise<void>}
 */
export const runPlaydateAutoClose = async () => {
  try {
    const { completed, cancelled } = await playdateService.closeExpiredPlaydates();
    if (completed || cancelled) {
      logger.info(`[PlaydateAutoCloseJob] Completed ${completed}, cancelled ${cancelled} past playdates`);
    }
  } catch (error) {
    logger.error(`[PlaydateAutoCloseJob] Failed: ${error.message}`);
  }
};

/**
 * @returns {import('node-cron').ScheduledTask}
 */
export const startPlaydateAutoCloseJob = () =>
  cron.schedule(SCHEDULE, runPlaydateAutoClose, { timezone: env.APP_TIMEZONE });

export default startPlaydateAutoCloseJob;
