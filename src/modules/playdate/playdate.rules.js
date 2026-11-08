import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { PARTICIPANT_STATUS } from './playdate.constants.js';

/**
 * Pure domain rules for playdate operations.
 * The AI assistant reuses them (ai-assistant/safety-rules.js), never the other way around.
 */

// Water activities: children need one adult each (a "màu nước" painting or "uống nước" is not one)
export const HIGH_RISK_WATER_REGEX = /(?<!màu\s|uống\s)(bơi|tắm|hồ bơi|chơi nước|công viên nước|suối|biển)/i;

const idOf = (ref) => (ref?._id || ref)?.toString();

/**
 * Every child of the host in a playdate, main child first (older playdates only have hostChildId)
 * @param {{ hostChildId: Object|string, hostChildIds?: Array<Object|string> }} playdate
 * @returns {Array<Object|string>} The stored values (ids or populated children)
 */
export const hostChildrenOf = (playdate) => {
  const list = playdate?.hostChildIds?.length ? playdate.hostChildIds : [playdate?.hostChildId];
  const seen = new Set();
  return list.filter((child) => {
    const id = idOf(child);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * Ids of every child of the host in a playdate
 * @param {Object} playdate
 * @returns {string[]}
 */
export const hostChildIdsOf = (playdate) => hostChildrenOf(playdate).map(idOf);

/**
 * Adults needed for a group: 1 per 2 children under 5, 1 per 3 older children, 1 per child for water activities
 * @param {{ totalKids?: number, under5Count?: number, over5Count?: number, hasHighRisk?: boolean }} input
 * @returns {number}
 */
export const calculateChaperoneRequirement = ({ totalKids = 1, under5Count = 0, over5Count = 0, hasHighRisk = false } = {}) => {
  if (hasHighRisk) return Math.max(1, totalKids);
  return Math.max(1, Math.ceil(under5Count / 2) + Math.ceil(over5Count / 3));
};

/**
 * Calculate chaperone requirements and current confirmation status for a playdate (BUD-49 Part B5).
 * @param {Object} playdate
 * @param {string} [parentIdStr]
 * @returns {{
 *   requiredChaperones: number,
 *   confirmedChaperones: number,
 *   isChaperoneSufficient: boolean,
 *   isChaperoneConfirmedByMe: boolean,
 *   missingChaperones: number,
 *   under5Count: number,
 *   over5Count: number
 * }}
 */
export const computeChaperoneSummary = (playdate, parentIdStr = null) => {
  const confirmedChaperones = (playdate.chaperones || []).length;
  let under5Count = 0;
  let over5Count = 0;

  hostChildrenOf(playdate).forEach((child) => {
    const age = child && typeof child === 'object' && child.dateOfBirth ? calculateAgeYears(child.dateOfBirth) : null;
    if (age !== null && age < 5) under5Count++;
    else over5Count++;
  });

  (playdate.participants || []).forEach((p) => {
    if (p.status === PARTICIPANT_STATUS.ACCEPTED && p.childId && typeof p.childId === 'object' && p.childId.dateOfBirth) {
      const age = calculateAgeYears(p.childId.dateOfBirth);
      if (age !== null && age < 5) under5Count++;
      else over5Count++;
    }
  });

  const allText = `${playdate.activity || ''} ${playdate.note || ''}`;
  const hasHighRisk = HIGH_RISK_WATER_REGEX.test(allText);
  const totalKids = under5Count + over5Count;
  const requiredChaperones = calculateChaperoneRequirement({ totalKids, under5Count, over5Count, hasHighRisk });
  const isChaperoneSufficient = confirmedChaperones >= requiredChaperones;
  const isChaperoneConfirmedByMe = parentIdStr
    ? (playdate.chaperones || []).some((c) => (c.parentId?._id || c.parentId)?.toString() === parentIdStr)
    : false;

  return {
    requiredChaperones,
    confirmedChaperones,
    isChaperoneSufficient,
    isChaperoneConfirmedByMe,
    missingChaperones: Math.max(0, requiredChaperones - confirmedChaperones),
    under5Count,
    over5Count,
  };
};

