import { getZonedParts, getScheduledStart, intervalsOverlap } from '../../shared/helpers/date.helper.js';
import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { distanceKmBetween } from '../discovery/matching.rules.js';
import {
  TIME_SLOT_START,
  SUGGESTION_LIMITS,
  PLACE_TYPE_MIN_AGE,
  PREFERRED_LOCATION_PLACE_TYPES,
  TODDLER_DURATION_CAPS,
} from './playdate.constants.js';
import { PLAYDATE_ACTIVITIES } from './playdate.activities.js';

/**
 * Playdate planning suggestions (pure functions): time slots, activities and place ranking.
 * The playdate suggestion service loads the data; these functions only decide.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const pad = (value) => String(value).padStart(2, '0');

/**
 * Calendar days from `from` to `to` (inclusive), as seen in the business time zone
 * @param {Date} from
 * @param {Date} to
 * @returns {Array<{ date: string, noon: Date, dayType: 'weekday'|'weekend' }>}
 */
export const listCalendarDays = (from, to) => {
  const first = getZonedParts(from);
  const last = getZonedParts(to);
  const lastDay = Date.UTC(last.year, last.month - 1, last.day);
  const days = [];
  for (let cursor = Date.UTC(first.year, first.month - 1, first.day); cursor <= lastDay; cursor += DAY_MS) {
    const day = new Date(cursor);
    const weekDay = day.getUTCDay();
    days.push({
      date: `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`,
      // Noon UTC stays on the same calendar day in the business time zone
      noon: new Date(cursor + DAY_MS / 2),
      dayType: weekDay === 0 || weekDay === 6 ? 'weekend' : 'weekday',
    });
  }
  return days;
};

/**
 * Best start times for a group of families:
 * +1 per parent whose preferred days AND time slots both contain the candidate (parents without
 * preferences are neutral); past candidates and candidates overlapping a busy interval are dropped.
 * Ties: earliest first; when nobody set preferences, weekend mornings come first.
 *
 * @param {Object} input
 * @param {Array<Object>} input.parents - Parents involved (preferences)
 * @param {Date} input.from
 * @param {Date} input.to
 * @param {number} input.durationMinutes
 * @param {Array<{ start: Date, end: Date }>} [input.busy] - Upcoming playdates of the children involved
 * @param {Date} [input.now]
 * @param {number} [input.limit]
 * @returns {Array<Object>}
 */
export const suggestTimeSlots = ({
  parents,
  from,
  to,
  durationMinutes,
  busy = [],
  now = new Date(),
  limit = SUGGESTION_LIMITS.TIME_SLOTS,
}) => {
  const candidates = [];
  for (const day of listCalendarDays(from, to)) {
    for (const [timeSlot, time] of Object.entries(TIME_SLOT_START)) {
      const start = getScheduledStart(day.noon, time);
      const end = new Date(start.getTime() + durationMinutes * MINUTE_MS);
      if (start <= now) continue;
      if (busy.some((interval) => intervalsOverlap(start, end, interval.start, interval.end))) continue;

      const matchedParents = parents.filter(
        (parent) =>
          (parent.preferences?.preferredPlaydateDays || []).includes(day.dayType) &&
          (parent.preferences?.preferredTimeSlots || []).includes(timeSlot)
      ).length;

      candidates.push({
        date: day.date,
        time,
        durationMinutes,
        dayType: day.dayType,
        timeSlot,
        matchedParents,
        totalParents: parents.length,
        start,
      });
    }
  }

  const nobodyMatches = candidates.every((c) => c.matchedParents === 0);
  const weekendMorning = (c) => (c.dayType === 'weekend' && c.timeSlot === 'morning' ? 1 : 0);
  candidates.sort(
    (a, b) =>
      b.matchedParents - a.matchedParents ||
      (nobodyMatches ? weekendMorning(b) - weekendMorning(a) : 0) ||
      a.start - b.start
  );

  return candidates.slice(0, limit).map(({ start: _start, ...slot }) => slot);
};

/**
 * Suggested playdate length for an activity: its usual duration, shorter when the youngest child is small
 * @param {{ durationMinutes: number }} activity
 * @param {number|null} youngestAge
 * @returns {number}
 */
export const suggestDuration = (activity, youngestAge) => {
  const cap = youngestAge === null ? null : TODDLER_DURATION_CAPS.find((c) => youngestAge < c.underAge);
  return cap ? Math.min(activity.durationMinutes, cap.maxMinutes) : activity.durationMinutes;
};

// "Na", "Na và Bin", "Na, Bin và Su"
const joinNames = (names) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;

/**
 * Activities the children are likely to enjoy together: the most children sharing an interest first,
 * only activities suitable for every child's age. Falls back to generic age-appropriate activities.
 *
 * @param {Array<Object>} children - Child documents (displayName, dateOfBirth, interests, favoriteActivities)
 * @param {{ limit?: number, now?: Date }} [options]
 * @returns {Array<{ key: string, title: string, placeTypes: string[], durationMinutes: number, sharedCount: number, reason: string }>}
 */
export const suggestActivities = (children, { limit = SUGGESTION_LIMITS.ACTIVITIES, now = new Date() } = {}) => {
  const kids = children.map((child) => ({
    name: child.displayName,
    age: calculateAgeYears(child.dateOfBirth, now),
    items: [...(child.interests || []), ...(child.favoriteActivities || [])].map((item) => item.toLowerCase()),
  }));
  const ages = kids.map((kid) => kid.age).filter((age) => age !== null);
  const youngest = ages.length ? Math.min(...ages) : null;
  const oldest = ages.length ? Math.max(...ages) : null;
  const fitsAge = (activity) => youngest === null || (youngest >= activity.minAge && oldest <= activity.maxAge);
  const matchedTags = (kid, activity) => activity.tags.filter((tag) => kid.items.some((item) => item.includes(tag)));

  const label = (activity) => activity.key.toLowerCase();
  const reasonFor = (activity, fans) => {
    if (kids.length === 1) return `${fans[0].name} thích ${label(activity)}`;
    if (fans.length === kids.length) {
      return `${kids.length === 2 ? 'Cả hai bé' : `Cả ${kids.length} bé`} đều thích ${label(activity)}`;
    }
    return `${joinNames(fans.map((kid) => kid.name))} thích ${label(activity)}`;
  };
  const toSuggestion = (activity, sharedCount, reason) => ({
    key: activity.key,
    title: activity.title,
    placeTypes: activity.placeTypes,
    durationMinutes: suggestDuration(activity, youngest),
    sharedCount,
    reason,
  });

  const matches = PLAYDATE_ACTIVITIES.filter(fitsAge)
    .map((activity) => {
      const fans = kids.filter((kid) => matchedTags(kid, activity).length > 0);
      const tagOverlap = kids.reduce((sum, kid) => sum + matchedTags(kid, activity).length, 0);
      return { activity, fans, tagOverlap };
    })
    .filter(({ fans }) => fans.length > 0)
    .sort((a, b) => b.fans.length - a.fans.length || b.tagOverlap - a.tagOverlap);

  if (matches.length > 0) {
    return matches
      .slice(0, limit)
      .map(({ activity, fans }) => toSuggestion(activity, fans.length, reasonFor(activity, fans)));
  }

  return PLAYDATE_ACTIVITIES.filter((activity) => activity.isGeneric && fitsAge(activity))
    .slice(0, limit)
    .map((activity) => toSuggestion(activity, 0, 'Phù hợp với độ tuổi của các bé'));
};

/**
 * Place types every parent who set location preferences likes (intersection)
 * @param {Array<Object>} parents
 * @returns {Set<string>} PLACE_TYPES values
 */
export const preferredPlaceTypes = (parents) => {
  const lists = parents.map((parent) => parent.preferences?.preferredLocations || []).filter((list) => list.length);
  if (!lists.length) return new Set();
  const common = lists.reduce((shared, list) => shared.filter((location) => list.includes(location)));
  return new Set(common.flatMap((location) => PREFERRED_LOCATION_PLACE_TYPES[location] || []));
};

/**
 * Average of [lng, lat] points (fine at city scale)
 * @param {Array<[number, number]>} points
 * @returns {[number, number]}
 */
export const midpointOf = (points) => [
  points.reduce((sum, [lng]) => sum + lng, 0) / points.length,
  points.reduce((sum, [, lat]) => sum + lat, 0) / points.length,
];

// 0.1 km precision, like a map
const roundKm = (km) => Math.round(km * 10) / 10;

/**
 * Rank nearby places for the group: preferred types first, then nearest to the families' midpoint.
 * Types too old for the youngest child are dropped. Only the place's own (public, map) coordinates are
 * returned, for the map link: never the midpoint nor a family's coordinates.
 *
 * Distances are measured like Discovery: from each family's saved location (the center of its ward,
 * geocoded from area + city) to the place, great-circle with the MongoDB earth radius.
 *
 * @param {Array<Object>} places - Places from placesService.getNearbyPlaces (distanceMeters from the midpoint)
 * @param {Object} options
 * @param {Set<string>} options.preferredTypes
 * @param {number|null} options.youngestAge
 * @param {Array<{ parentId: string, label: string, area: string, point: [number, number] }>} options.families
 *   Families with a location, the caller first (points only used to compute distances)
 * @param {number} [options.limit]
 * @returns {Array<Object>}
 */
export const rankPlaces = (places, { preferredTypes, youngestAge, families, limit = SUGGESTION_LIMITS.PLACES }) =>
  places
    .filter((place) => youngestAge === null || youngestAge >= (PLACE_TYPE_MIN_AGE[place.placeType] || 0))
    .map((place) => ({ place, isPreferredType: preferredTypes.has(place.placeType) }))
    .sort((a, b) => Number(b.isPreferredType) - Number(a.isPreferredType) || (a.place.distanceMeters ?? Infinity) - (b.place.distanceMeters ?? Infinity))
    .slice(0, limit)
    .map(({ place, isPreferredType }) => ({
      id: place.id,
      placeId: place.placeId,
      name: place.name,
      type: place.placeType,
      address: place.address,
      openingHours: place.openingHours || '',
      // [lng, lat] of the place itself (OpenStreetMap data), used to open it on a map
      coordinates: place.coordinates || null,
      osmUrl: place.osmUrl || null,
      isPreferredType,
      // Distance from each family's ward center (the caller first)
      familyDistances: place.coordinates
        ? families.map(({ parentId, label, area, point }) => ({
            parentId,
            label,
            area,
            distanceKm: roundKm(distanceKmBetween(point, place.coordinates)),
          }))
        : [],
    }));
