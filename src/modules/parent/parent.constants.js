export const PREFERRED_DAYS = Object.freeze(['weekday', 'weekend']);

export const TIME_SLOTS = Object.freeze(['morning', 'afternoon', 'evening']);

export const PREFERRED_LOCATIONS = Object.freeze([
  'indoor',
  'outdoor',
  'park',
  'kids_cafe',
  'home',
  'library',
  'museum',
  'mall',
  'sports_center',
  'pool',
]);

export const CONNECTION_PRIVACY = Object.freeze({
  EVERYONE: 'everyone',
  NOBODY: 'nobody',
});

export const MESSAGE_PRIVACY = Object.freeze({
  CONNECTED_ONLY: 'connected_only',
});

// Business limits for matching preferences
export const PREFERENCE_LIMITS = Object.freeze({
  MIN_DISTANCE_KM: 1,
  MAX_DISTANCE_KM: 100,
  MIN_CHILD_AGE: 0,
  MAX_CHILD_AGE: 18,
});
