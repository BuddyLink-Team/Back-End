/**
 * Place types supported for nearby recommendations and discovery filters
 */
export const PLACE_TYPES = Object.freeze({
  PARK: 'park',
  KIDS_CAFE: 'kids_cafe',
  PLAYGROUND: 'playground',
  LIBRARY: 'library',
  SPORTS_CENTER: 'sports_center',
  WORKSHOP: 'workshop',
});

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
  // Nearby candidates fetched before scoring, so the best matches are not cut off by distance
  CANDIDATE_POOL_SIZE: 100,
  EARTH_RADIUS_KM: 6371,
});
