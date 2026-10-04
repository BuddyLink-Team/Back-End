import cron from 'node-cron';
import logger from '../../shared/logger/index.js';
import { reconcileAchievements } from './gamification.service.js';
import { GAMIFICATION_TIMEZONE } from './gamification.rules.js';

let running = false;
export async function runGamificationJob() {
  if (running) return;
  running = true;
  try { await reconcileAchievements(); }
  catch (error) { logger.error({ err: error }, 'Gamification reconciliation failed'); }
  finally { running = false; }
}
export function startGamificationJob() {
  // Close the previous week and reset streaks that missed a full week.
  return cron.schedule('0 0 * * 1', runGamificationJob, { timezone: GAMIFICATION_TIMEZONE });
}
