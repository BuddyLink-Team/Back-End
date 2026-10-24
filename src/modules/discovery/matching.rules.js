import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { MATCHING_WEIGHTS, DISCOVERY_DEFAULTS } from './discovery.constants.js';

/**
 * Smart Matching rules (pure functions): shared by Discovery and the playdate planner.
 */

// Lower-cased interests + favorite activities of one or several children
const collectInterests = (children) => {
  const set = new Set();
  children.forEach((child) => {
    (child?.interests || []).forEach((i) => set.add(i.toLowerCase()));
    (child?.favoriteActivities || []).forEach((a) => set.add(a.toLowerCase()));
  });
  return set;
};

// Jaccard similarity |A ∩ B| / |A ∪ B| of two sets
const jaccard = (setA, setB) => {
  let intersection = 0;
  setA.forEach((item) => {
    if (setB.has(item)) intersection++;
  });
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
};

/**
 * Great-circle distance in km between two [lng, lat] points
 * @param {[number, number]} pointA
 * @param {[number, number]} pointB
 * @returns {number|null} null when a point is missing
 */
export const distanceKmBetween = (pointA, pointB) => {
  if (!Array.isArray(pointA) || !Array.isArray(pointB)) return null;
  const [lng1, lat1] = pointA;
  const [lng2, lat2] = pointB;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return DISCOVERY_DEFAULTS.EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Age Match Score (max 30 points).
 * Full score if target child's age is within parent's preferred age range.
 * Decays linearly as age difference increases.
 */
export const calcAgeScore = (currentParent, targetChild) => {
  const maxPoints = MATCHING_WEIGHTS.AGE_MATCH;
  const preferredRange = currentParent.preferences?.preferredAgeRange;

  if (!preferredRange || !targetChild.dateOfBirth) {
    return maxPoints * 0.5; // Neutral score when data is missing
  }

  const childAge = calculateAgeYears(targetChild.dateOfBirth);
  if (childAge === null) return maxPoints * 0.5;

  const { min, max } = preferredRange;

  // Perfect match: within range
  if (childAge >= min && childAge <= max) {
    return maxPoints;
  }

  // Decay: distance from nearest range boundary
  const diff = childAge < min ? min - childAge : childAge - max;
  return Math.max(0, maxPoints - diff * 10);
};

/**
 * Interest Overlap Score (max 35 points).
 * Uses Jaccard similarity between all current children's interests/activities
 * and the target child's interests/activities.
 */
export const calcInterestScore = (currentChildren, targetChild) => {
  const maxPoints = MATCHING_WEIGHTS.INTEREST_OVERLAP;

  if (!currentChildren || currentChildren.length === 0) {
    return maxPoints * 0.3; // Low neutral score
  }

  const currentSet = collectInterests(currentChildren);
  const targetSet = collectInterests([targetChild]);

  if (currentSet.size === 0 || targetSet.size === 0) {
    return maxPoints * 0.3;
  }

  return Math.round(jaccard(currentSet, targetSet) * maxPoints);
};

/**
 * Distance Proximity Score (max 20 points).
 * Closer parents get higher scores. Linear decay up to the radius of the current search,
 * so every profile inside the searched radius can earn distance points.
 */
export const calcDistanceScore = (distanceKm, searchRadiusKm) => {
  const maxPoints = MATCHING_WEIGHTS.DISTANCE_PROXIMITY;
  const maxDistanceKm = searchRadiusKm || DISCOVERY_DEFAULTS.DEFAULT_MAX_DISTANCE_KM;

  if (distanceKm <= 0) return maxPoints;
  if (distanceKm >= maxDistanceKm) return 0;

  const proximity = 1 - distanceKm / maxDistanceKm;
  return Math.round(proximity * maxPoints);
};

/**
 * Preference Match Score (max 15 points).
 * Compares preferredDays, timeSlots, and preferredLocations between parents.
 * More overlapping preferences → higher score.
 */
export const calcPreferenceScore = (currentParent, targetParent) => {
  const maxPoints = MATCHING_WEIGHTS.PREFERENCE_MATCH;
  const cp = currentParent.preferences || {};
  const tp = targetParent.preferences || {};

  let totalCategories = 0;
  let matchRatio = 0;

  ['preferredPlaydateDays', 'preferredTimeSlots', 'preferredLocations'].forEach((field) => {
    if (cp[field]?.length && tp[field]?.length) {
      totalCategories++;
      matchRatio += jaccard(new Set(cp[field]), new Set(tp[field]));
    }
  });

  if (totalCategories === 0) {
    return Math.round(maxPoints * 0.5); // Neutral when no preference data
  }

  const averageMatch = matchRatio / totalCategories;
  return Math.round(averageMatch * maxPoints);
};

/**
 * Calculate overall match score between current parent and a target child/parent pair.
 * Score ranges from 0 to 100.
 *
 * @param {Object} currentParent - Authenticated parent document
 * @param {Array} currentChildren - Children belonging to current parent
 * @param {Object} targetChild - Target child document
 * @param {Object} targetParent - Target parent document
 * @param {number} distanceKm - Distance between parents in km
 * @param {number} searchRadiusKm - Radius of the current search (query filter or preference)
 * @returns {number} Match score (0-100)
 */
export const calculateMatchScore = (currentParent, currentChildren, targetChild, targetParent, distanceKm, searchRadiusKm) => {
  let score = 0;

  score += calcAgeScore(currentParent, targetChild);
  score += calcInterestScore(currentChildren, targetChild);
  score += calcDistanceScore(distanceKm, searchRadiusKm);
  score += calcPreferenceScore(currentParent, targetParent);

  return Math.min(100, Math.max(0, Math.round(score)));
};

/**
 * Match score of two children (playdate context, 0-100). Same weights as Discovery, but:
 * - interests are compared between the two children only (not all of a parent's children);
 * - distance uses the parents' saved coordinates and the default discovery radius.
 *
 * @param {Object} childA
 * @param {Object} parentA - Parent of childA (preferences, location)
 * @param {Object} childB
 * @param {Object} parentB - Parent of childB
 * @returns {number}
 */
export const calculateChildPairScore = (childA, parentA, childB, parentB) => {
  const distanceKm = distanceKmBetween(
    parentA?.location?.coordinates?.coordinates,
    parentB?.location?.coordinates?.coordinates
  );

  let score = 0;
  score += calcAgeScore(parentA || {}, childB);
  score += calcInterestScore([childA], childB);
  // Unknown distance: neutral half score
  score += distanceKm === null
    ? MATCHING_WEIGHTS.DISTANCE_PROXIMITY * 0.5
    : calcDistanceScore(distanceKm, DISCOVERY_DEFAULTS.DEFAULT_MAX_DISTANCE_KM);
  score += calcPreferenceScore(parentA || {}, parentB || {});

  return Math.min(100, Math.max(0, Math.round(score)));
};
