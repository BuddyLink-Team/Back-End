import cron from 'node-cron';
import logger from '../shared/logger/index.js';
import gamificationService from '../modules/gamification/gamification.service.js';
import { GAMIFICATION_TIMEZONE } from '../modules/gamification/gamification.constants.js';
import { emitSystemEvent, SYSTEM_EVENTS } from '../shared/events/system.events.js';

// Every Monday at 00:00 (Vietnam time): close the previous week
const SCHEDULE = '0 0 * * 1';
// Every Saturday at 09:00 (Vietnam time): the weekend is left to keep the streak
const STREAK_REMINDER_SCHEDULE = '0 9 * * 6';

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
    void emitSystemEvent(SYSTEM_EVENTS.CRON_JOB_FAILED, { jobName: 'GamificationJob', error: error.message });
  } finally {
    isRunning = false;
  }
};

/**
 * Remind the parents whose weekly streak breaks unless they complete a playdate this week
 * @returns {Promise<void>}
 */
export const runStreakReminderJob = async () => {
  try {
    const sent = await gamificationService.sendStreakReminders();
    if (sent > 0) logger.info(`[StreakReminderJob] Sent ${sent} streak reminder(s)`);
  } catch (error) {
    logger.error(`[StreakReminderJob] Failed: ${error.message}`);
    void emitSystemEvent(SYSTEM_EVENTS.CRON_JOB_FAILED, { jobName: 'StreakReminderJob', error: error.message });
  }
};

/**
 * @returns {import('node-cron').ScheduledTask[]}
 */
export const startGamificationJob = () => [
  cron.schedule(SCHEDULE, runGamificationJob, { timezone: GAMIFICATION_TIMEZONE }),
  cron.schedule(STREAK_REMINDER_SCHEDULE, runStreakReminderJob, { timezone: GAMIFICATION_TIMEZONE }),
];

export default startGamificationJob;
