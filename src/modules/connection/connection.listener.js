import logger from '../../shared/logger/index.js';
import connectionService from './connection.service.js';
import { CHILD_PAIR_SOURCES } from './connection.constants.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';

/**
 * Children who played together in a completed playdate become a pair on their parents' connection.
 * Failures are only logged: they never undo the completion.
 * @param {{ childPairs?: Array<{ parentIds: string[], childIds: string[] }> }} payload
 */
const addPlaydatePairs = async ({ childPairs = [] }) => {
  for (const { parentIds, childIds } of childPairs) {
    try {
      const connection = await connectionService.getAcceptedConnectionBetween(parentIds[0], parentIds[1]);
      if (!connection) continue;
      await connectionService.addChildPair(connection._id, {
        childIdA: childIds[0],
        childIdB: childIds[1],
        source: CHILD_PAIR_SOURCES.PLAYDATE,
      });
    } catch (error) {
      logger.error(`[ConnectionListeners] Child pair from playdate failed: ${error.message}`);
    }
  }
};

let isRegistered = false;

/**
 * Connection reactions to other modules' events. Registered once from app.js.
 */
export const registerConnectionListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  onPlaydateEvent(PLAYDATE_EVENTS.COMPLETED, addPlaydatePairs);
};

export default registerConnectionListeners;
