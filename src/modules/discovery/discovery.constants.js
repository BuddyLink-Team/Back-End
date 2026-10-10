/**
 * Smart Matching weight configuration (total = 100)
 */
export const MATCHING_WEIGHTS = Object.freeze({
  AGE_MATCH: 30,
  INTEREST_OVERLAP: 35,
  DISTANCE_PROXIMITY: 20,
  PREFERENCE_MATCH: 15,
});

/**
 * Discovery module default values
 */
export const DISCOVERY_DEFAULTS = Object.freeze({
  DEFAULT_MAX_DISTANCE_KM: 15,
  MAX_RESULTS_PER_REQUEST: 20,
  // Upper bound of visible parents read inside the radius (keeps very dense areas cheap)
  MAX_NEARBY_PARENTS: 1000,
  // Nearest discoverable children (not swiped, matching filters) scored per request
  CANDIDATE_POOL_SIZE: 100,
  EARTH_RADIUS_KM: 6371,
});
