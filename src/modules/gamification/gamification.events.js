import gamificationService from './gamification.service.js';
import logger from '../../shared/logger/index.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';
import { onConnectionEvent, CONNECTION_EVENTS } from '../connection/connection.events.js';

let isRegistered = false;

/**
 * Update streaks and badges of the given parents. A failure is only logged:
 * the weekly job and the next achievements read recalculate everything.
 * @param {Array<string>} parentIds
 */
const syncParents = async (parentIds = []) => {
  for (const parentId of new Set(parentIds.filter(Boolean))) {
    try {
      await gamificationService.syncParentAchievements(parentId);
    } catch (error) {
      logger.error(`[GamificationEvents] Achievement update failed for parent ${parentId}: ${error.message}`);
    }
  }
};

/**
 * Gamification reactions to other modules' events. Registered once at app startup.
 */
export const registerGamificationEventListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  onPlaydateEvent(PLAYDATE_EVENTS.COMPLETED, ({ parentIds }) => syncParents(parentIds));
  onConnectionEvent(CONNECTION_EVENTS.ACCEPTED, ({ parentIds }) => syncParents(parentIds));
};

export default registerGamificationEventListeners;
