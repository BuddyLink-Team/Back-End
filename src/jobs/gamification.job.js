import cron from 'node-cron';
import logger from '../shared/logger/index.js';
import gamificationService from '../modules/gamification/gamification.service.js';
import { GAMIFICATION_TIMEZONE } from '../modules/gamification/gamification.constants.js';

// Every Monday at 00:00 (Vietnam time): close the previous week
const SCHEDULE = '0 0 * * 1';

let isRunning = false;

/**
 * Recalculate streaks and badges of every parent, resetting streaks that missed a full week.
 * Skipped when a previous run is still in progress.
 * @returns {Promise<void>}
 */
export const runGamificationJob = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    await gamificationService.reconcileAchievements();
  } catch (error) {
    logger.error(`[GamificationJob] Failed: ${error.message}`);
  } finally {
    isRunning = false;
  }
};

/**
 * @returns {import('node-cron').ScheduledTask}
 */
export const startGamificationJob = () =>
  cron.schedule(SCHEDULE, runGamificationJob, { timezone: GAMIFICATION_TIMEZONE });

export default startGamificationJob;
