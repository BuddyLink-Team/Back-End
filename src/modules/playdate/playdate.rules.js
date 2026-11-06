import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { PARTICIPANT_STATUS } from './playdate.constants.js';
import { HIGH_RISK_WATER_REGEX, calculateChaperoneRequirement } from '../ai-assistant/safety-rules.js';

/**
 * Pure domain rules for playdate operations.
 */

/**
 * Calculate chaperone requirements and current confirmation status for a playdate (BUD-49 Part B5).
 * @param {Object} playdate
 * @param {string} [parentIdStr]
 * @returns {{
 *   requiredChaperones: number,
 *   confirmedChaperones: number,
 *   isChaperoneSufficient: boolean,
 *   isChaperoneConfirmedByMe: boolean,
 *   under5Count: number,
 *   over5Count: number
 * }}
 */
export const computeChaperoneSummary = (playdate, parentIdStr = null) => {
  const confirmedChaperones = (playdate.chaperones || []).length;
  let under5Count = 0;
  let over5Count = 0;

  if (playdate.hostChildId && typeof playdate.hostChildId === 'object' && playdate.hostChildId.dateOfBirth) {
    const age = calculateAgeYears(playdate.hostChildId.dateOfBirth);
    if (age !== null && age < 5) under5Count++;
    else over5Count++;
  } else {
    over5Count++;
  }

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
    under5Count,
    over5Count,
  };
};

