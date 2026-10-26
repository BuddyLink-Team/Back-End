export const PLAYDATE_STATUS = Object.freeze({
  UPCOMING: 'upcoming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

// displayStatus of a playdate for the viewer (PlaydateResponseDTO); completed / cancelled are the stored status
export const PLAYDATE_DISPLAY_STATUS = Object.freeze({
  PENDING: 'pending', // an answer is awaited (the viewer's, or an invitee's for the host)
  CONFIRMED: 'confirmed', // at least one invitee accepted
  DECLINED: 'declined', // the viewer declined the invitation
  AWAITING_PLAYMATES: 'awaiting_playmates', // host: nobody joined yet (all declined or none invited)
});

export const PARTICIPANT_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

export const RESCHEDULE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
});

// Friends returned by GET /playdates/friends (narrow the list with ?search=)
export const INVITABLE_FRIENDS_LIMIT = 50;

// Suggested duration is capped for young children: youngest age below `underAge` -> at most `maxMinutes`
export const TODDLER_DURATION_CAPS = Object.freeze([
  { underAge: 3, maxMinutes: 90 },
  { underAge: 5, maxMinutes: 120 },
]);

export const PLAYDATE_RULES = Object.freeze({
  // Children further apart than this get an AGE_GAP warning (never blocks the invitation)
  MAX_AGE_GAP_YEARS: 3,
  DEFAULT_DURATION_MINUTES: 120,
  MIN_DURATION_MINUTES: 30,
  MAX_DURATION_MINUTES: 480,
});

export const PLAYDATE_WARNING_CODES = Object.freeze({
  AGE_GAP: 'AGE_GAP',
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
});

// Start time of each preferred time slot (Parent.preferences.preferredTimeSlots)
export const TIME_SLOT_START = Object.freeze({
  morning: '09:00',
  afternoon: '15:00',
  evening: '18:00',
});

export const SUGGESTION_LIMITS = Object.freeze({
  // The FE shows 4 of each and the rest behind "Xem thêm"
  TIME_SLOTS: 8,
  PLACES: 8,
  MAX_PLACES: 20,
  ACTIVITIES: 8,
  // Longest from -> to range of the time slot suggestions, in days
  MAX_RANGE_DAYS: 14,
  // Default range: tomorrow + this many days
  DEFAULT_RANGE_DAYS: 7,
  // Children of other families that can be planned for at once
  MAX_PARTICIPANT_CHILDREN: 10,
});

// Place types not suggested when the youngest child is under this age
export const PLACE_TYPE_MIN_AGE = Object.freeze({
  sports_center: 4,
  workshop: 4,
});

// Place types matching each Parent.preferences.preferredLocations value
export const PREFERRED_LOCATION_PLACE_TYPES = Object.freeze({
  park: ['park'],
  outdoor: ['park', 'playground'],
  kids_cafe: ['kids_cafe'],
  indoor: ['kids_cafe', 'library'],
  library: ['library'],
  museum: ['workshop'],
  sports_center: ['sports_center'],
  pool: ['sports_center'],
  mall: ['kids_cafe'],
  home: [],
});

// Search radius around the families' midpoint
export const PLACE_SUGGESTION_RADIUS = Object.freeze({
  MIN_METERS: 5000,
  MAX_METERS: 20000,
  // Added to the distance of the farthest family
  MARGIN_METERS: 2000,
});

// Playdate reminders (jobs/playdate-reminder.job.js)
export const REMINDER_KINDS = Object.freeze({
  H24: 'h24',
  H1: 'h1',
});

export const PLAYDATE_REMINDER = Object.freeze({
  // The job runs every N minutes; a reminder may be sent up to one interval early
  JOB_INTERVAL_MINUTES: 15,
});
