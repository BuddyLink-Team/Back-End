import childService from '../../child/child.service.js';
import { toChildItem } from './tool-sanitizer.js';

/**
 * State shared by the tools of one turn
 * @param {Object} input
 * @param {string} input.userId
 * @param {Object} input.parent - Parent document of the caller
 * @param {Object|null} input.draft - Plan in progress (mutated by the tools, saved with the turn)
 * @param {Object|null} [input.lastMatchCard] - Latest playmate list shown in this session
 * @returns {Object}
 */
export const createToolContext = ({ userId, parent, draft, lastMatchCard = null }) => {
  let childrenPromise = null;
  return {
    userId,
    parent,
    parentId: parent._id,
    draft,
    lastMatchCard,
    turn: {
      cards: [],
      toolsUsed: [],
      // Places shown this turn (id -> place), so a later tool can use one by id
      places: new Map(),
    },
    // Own active children not locked by the Free plan, loaded once per turn
    getChildren() {
      if (!childrenPromise) {
        childrenPromise = childService
          .getMyChildren(userId)
          .then((children) => children.filter((child) => !child.isLocked).map(toChildItem));
      }
      return childrenPromise;
    },
  };
};

export default createToolContext;
