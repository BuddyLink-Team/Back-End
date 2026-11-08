import { getZonedParts, getScheduledStart, intervalsOverlap } from '../../shared/helpers/date.helper.js';
import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { distanceKmBetween } from '../discovery/matching.rules.js';
import {
  TIME_SLOT_START,
  TIME_SLOT_RANGES,
  SUGGESTION_LIMITS,
  PLAYDATE_TIME_RULES,
  OUTDOOR_PLACE_TYPES,
  PLACE_TYPE_MIN_AGE,
  PREFERRED_LOCATION_PLACE_TYPES,
  TODDLER_DURATION_CAPS,
} from './playdate.constants.js';
import { PLAYDATE_ACTIVITIES } from './playdate.activities.js';
import {
  checkPlaceOpeningHours,
  dayTypeOf,
  evaluateTimeIssues,
  isSuggestableSlot,
  TIME_ISSUE_SEVERITY,
} from './playdate-time.rules.js';

// Moved to playdate-time.rules.js (the rules on the time of a playdate); kept here for the callers
export { checkPlaceOpeningHours, dayTypeOf };

/**
 * Playdate planning suggestions (pure functions): time slots, activities and place ranking.
 * The playdate suggestion service loads the data; these functions only decide.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const pad = (value) => String(value).padStart(2, '0');

const toMinutes = (time) => {
  const [hours, minutes] = String(time).split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * Preferred time slot a start time belongs to (TIME_SLOT_RANGES), null outside every slot
 * @param {string} time - "HH:mm"
 * @returns {'morning'|'afternoon'|'evening'|null}
 */
export const timeSlotOf = (time) => {
  if (!/^\d{2}:\d{2}$/.test(String(time || ''))) return null;
  const minutes = toMinutes(time);
  const entry = Object.entries(TIME_SLOT_RANGES).find(
    ([, range]) => minutes >= toMinutes(range.from) && minutes <= toMinutes(range.to)
  );
  return entry ? entry[0] : null;
};

// Parents whose preferred days AND time slots both contain this day type and slot
const countParentsPreferring = (parents, dayType, timeSlot) =>
  timeSlot
    ? parents.filter(
        (parent) =>
          (parent.preferences?.preferredPlaydateDays || []).includes(dayType) &&
          (parent.preferences?.preferredTimeSlots || []).includes(timeSlot)
      ).length
    : 0;

/**
 * How well one start time fits the families' preferred days and time slots (same count as suggestTimeSlots)
 * @param {{ parents: Array<Object>, date: string, time: string }} input
 * @returns {{ matchedParents: number, totalParents: number, parentsWithPreferences: number, timeSlot: string|null, dayType: string }}
 */
export const evaluateSlotFit = ({ parents = [], date, time }) => {
  const timeSlot = timeSlotOf(time);
  const dayType = dayTypeOf(date);
  return {
    matchedParents: countParentsPreferring(parents, dayType, timeSlot),
    totalParents: parents.length,
    parentsWithPreferences: parents.filter(
      (parent) => parent.preferences?.preferredPlaydateDays?.length && parent.preferences?.preferredTimeSlots?.length
    ).length,
    timeSlot,
    dayType,
  };
};

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
 * Every time rule of the playdate applies (playdate-time.rules.js): a slot breaking a block or warn rule
 * (nap time, school hours, too late for the youngest child, place closed or closing early, dark park...)
 * is never offered; slots with only information notes (meal time, short notice, holiday) come after the
 * clean ones. Ties: earliest first; when nobody set preferences, weekend mornings come first.
 *
 * @param {Object} input
 * @param {Array<Object>} input.parents - Parents involved (preferences)
 * @param {Date} input.from
 * @param {Date} input.to
 * @param {number} input.durationMinutes
 * @param {Array<{ start: Date, end: Date }>} [input.busy] - Upcoming playdates of the children involved
 * @param {Array<number>} [input.ages] - Ages of every child of the playdate
 * @param {{ placeType?: string|null, openingHours?: string, coordinates?: number[] }|null} [input.place] - Chosen place
 * @param {Date} [input.now]
 * @param {number} [input.limit]
 * @returns {Array<Object>} Each slot with `notes`: codes of the information rules it touches
 */
export const suggestTimeSlots = ({
  parents,
  from,
  to,
  durationMinutes,
  busy = [],
  ages = [],
  place = null,
  now = new Date(),
  limit = SUGGESTION_LIMITS.TIME_SLOTS,
  // Older callers sent the opening hours alone
  placeOpeningHours = null,
  placeCoordinates = null,
}) => {
  const placeOfSlots = place || (placeOpeningHours ? { openingHours: placeOpeningHours, coordinates: placeCoordinates } : null);
  const candidates = [];
  for (const day of listCalendarDays(from, to)) {
    for (const [timeSlot, time] of Object.entries(TIME_SLOT_START)) {
      const start = getScheduledStart(day.noon, time);
      const end = new Date(start.getTime() + durationMinutes * MINUTE_MS);
      if (start <= now) continue;
      if (busy.some((interval) => intervalsOverlap(start, end, interval.start, interval.end))) continue;

      const issues = evaluateTimeIssues({ date: day.date, time, durationMinutes, ages, place: placeOfSlots, now });
      if (!isSuggestableSlot(issues)) continue;

      candidates.push({
        date: day.date,
        time,
        durationMinutes,
        dayType: day.dayType,
        timeSlot,
        matchedParents: countParentsPreferring(parents, day.dayType, timeSlot),
        totalParents: parents.length,
        notes: issues.filter((issue) => issue.severity === TIME_ISSUE_SEVERITY.INFO).map((issue) => issue.code),
        start,
      });
    }
  }

  const nobodyMatches = candidates.every((c) => c.matchedParents === 0);
  const weekendMorning = (c) => (c.dayType === 'weekend' && c.timeSlot === 'morning' ? 1 : 0);
  candidates.sort(
    (a, b) =>
      b.matchedParents - a.matchedParents ||
      a.notes.length - b.notes.length ||
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
export const rankPlaces = (places, { preferredTypes, youngestAge, families, targetStart, targetEnd, limit = SUGGESTION_LIMITS.PLACES }) =>
  places
    .filter((place) => youngestAge === null || youngestAge >= (PLACE_TYPE_MIN_AGE[place.placeType] || 0))
    .map((place) => {
      const isPreferredType = preferredTypes.has(place.placeType);
      // At the chosen time: closed places last, then places closing early or dark parks, then the others
      const issues = targetStart ? placeTimeIssues(place, targetStart, targetEnd) : [];
      const penalty = issues.some((i) => i.severity === TIME_ISSUE_SEVERITY.BLOCK) ? 2 : issues.length ? 1 : 0;
      return { place, isPreferredType, penalty };
    })
    .sort(
      (a, b) =>
        a.penalty - b.penalty ||
        Number(b.isPreferredType) - Number(a.isPreferredType) ||
        (a.place.distanceMeters ?? Infinity) - (b.place.distanceMeters ?? Infinity)
    )
    .slice(0, limit)
    .map(({ place, isPreferredType, penalty }) => ({
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
      // 0 fits the chosen time, 1 closes early / dark park, 2 closed (always 0 without a time)
      timePenalty: penalty,
      // OpenStreetMap tags of the place (attractions search, BUD-49 A3)
      tags: place.tags || {},
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

// Place rules of a time (closed, closing early, park after dark), for the ranking of places
const placeTimeIssues = (place, start, end) => {
  const opening = checkPlaceOpeningHours(place.openingHours, start, end, place.coordinates);
  const issues = [];
  if (opening.isKnown && !opening.isOpen) issues.push({ severity: TIME_ISSUE_SEVERITY.BLOCK });
  else if (opening.isKnown && opening.closesSoon) issues.push({ severity: TIME_ISSUE_SEVERITY.WARN });
  const endParts = getZonedParts(end);
  const [darkHours, darkMinutes] = PLAYDATE_TIME_RULES.OUTDOOR_DARK_AFTER.split(':').map(Number);
  if (OUTDOOR_PLACE_TYPES.includes(place.placeType) && endParts.hour * 60 + endParts.minute > darkHours * 60 + darkMinutes) {
    issues.push({ severity: TIME_ISSUE_SEVERITY.WARN });
  }
  return issues;
};

/**
 * Whether a place likely has structured attractions to search via Google (BUD-49 A3)
 * @param {{ placeType?: string, type?: string, name?: string, osmTags?: Object, tags?: Object }} place
 * @returns {'yes'|'no'|'uncertain'}
 */
export const shouldSearchAttractions = (place = {}) => {
  const type = place.placeType || place.type || '';
  const name = String(place.name || '').toLowerCase();
  const rawTags = place.osmTags || place.tags || {};
  const tagString = typeof rawTags === 'object'
    ? Object.entries(rawTags).map(([k, v]) => `${k}=${v}`).join(' ').toLowerCase()
    : String(rawTags).toLowerCase();

  // Certain indoor play venues always have specific attractions
  if (type === 'kids_cafe') return 'yes';

  // Specific sports/amusement venues or matching OSM tags
  const hasPlayKeywords =
    /bạt nhún|trampoline|leo núi|bowling|trượt băng|khu vui chơi|công viên nước|jump|roller/i.test(name) ||
    /water_park|climbing|bowling|ice_skating|trampoline|indoor_play|amusement_arcade|water_slide/i.test(tagString);
  if (type === 'sports_center' && hasPlayKeywords) return 'yes';

  // Free self-directed or generic places
  if (type === 'park' || type === 'library' || type === 'home') return 'no';

  // Ambiguous: cultural centers, general sports centers, community centers
  if (
    type === 'sports_center' ||
    type === 'workshop' ||
    /trung tâm|câu lạc bộ|khu giải trí/i.test(name) ||
    /community_centre|sports_centre|youth_centre/i.test(tagString)
  ) {
    return 'uncertain';
  }

  return 'no';
};
