import opening_hours from 'opening_hours';
import { getScheduledStart, getZonedParts } from '../../shared/helpers/date.helper.js';
import { PLAYDATE_TIME_RULES, OUTDOOR_PLACE_TYPES, HOURS_EXPECTED_PLACE_TYPES } from './playdate.constants.js';

/**
 * Rules on the time of a playdate (pure functions), shared by every place that picks or checks a time:
 * the AI plan warnings, the time suggestions (AI, Create Playdate form, chat polls), the place ranking,
 * the time check of the form and POST /playdates (BUD-49 C).
 */

// opening_hours reads the local clock of a Date: rebuild the business time zone (APP_TIMEZONE) wall clock in it
const toBusinessLocalDate = (date) => {
  const parts = getZonedParts(date);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
};

/**
 * Check if a place is open at a given interval or date using opening_hours npm package (BUD-49).
 * Checks the entire interval [startTime, endTime] with timezone awareness.
 * @param {string} openingHoursStr
 * @param {Date} startTime
 * @param {Date} [endTime]
 * @param {[number, number]} [coordinates] - [lng, lat]
 * @returns {{ isOpen: boolean, isKnown: boolean, closesSoon?: boolean }}
 */
export const checkPlaceOpeningHours = (openingHoursStr, startTime, endTime, coordinates) => {
  if (!openingHoursStr || typeof openingHoursStr !== 'string' || !openingHoursStr.trim()) {
    return { isOpen: true, isKnown: false };
  }
  try {
    const lat = Array.isArray(coordinates) && coordinates.length === 2 ? coordinates[1] : 10.7769;
    const lon = Array.isArray(coordinates) && coordinates.length === 2 ? coordinates[0] : 106.7009;
    const OH = opening_hours.default || opening_hours;
    const oh = new OH(openingHoursStr, { lat, lon, address: { country_code: 'vn' } });

    const localStart = toBusinessLocalDate(startTime);
    const end = endTime || new Date(startTime.getTime() + 60 * 60 * 1000);
    const localEnd = toBusinessLocalDate(end);

    const intervals = oh.getOpenIntervals(localStart, localEnd);
    const openWholeTime = intervals.some(([s, e]) => s <= localStart && e >= localEnd);

    const after30m = new Date(localEnd.getTime() + 30 * 60 * 1000);
    const closesSoon = openWholeTime && !oh.getState(after30m);

    return { isOpen: openWholeTime, isKnown: true, closesSoon };
  } catch (_e) {
    return { isOpen: true, isKnown: false };
  }
};

/**
 * Weekday or weekend of a calendar day
 * @param {string} date - "YYYY-MM-DD"
 * @returns {'weekday'|'weekend'}
 */
export const dayTypeOf = (date) => {
  const [year, month, day] = String(date).split('-').map(Number);
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekDay === 0 || weekDay === 6 ? 'weekend' : 'weekday';
};

export const TIME_ISSUE_SEVERITY = Object.freeze({
  BLOCK: 'block',
  WARN: 'warn',
  INFO: 'info',
});

export const TIME_ISSUE_CODES = Object.freeze({
  PAST_DATE: 'PAST_DATE',
  UNUSUAL_HOUR: 'UNUSUAL_HOUR',
  NAP_TIME: 'NAP_TIME',
  SCHOOL_HOURS: 'SCHOOL_HOURS',
  TOO_LONG_FOR_AGE: 'TOO_LONG_FOR_AGE',
  MEAL_TIME: 'MEAL_TIME',
  SHORT_NOTICE: 'SHORT_NOTICE',
  HOLIDAY: 'HOLIDAY',
  PLACE_CLOSED: 'PLACE_CLOSED',
  PLACE_CLOSES_EARLY: 'PLACE_CLOSES_EARLY',
  OUTDOOR_AFTER_DARK: 'OUTDOOR_AFTER_DARK',
  HOURS_UNKNOWN: 'HOURS_UNKNOWN',
});

// Rules about the playdate as a whole, not about the slot: they never remove a suggested time
const SLOT_INDEPENDENT_CODES = new Set([TIME_ISSUE_CODES.TOO_LONG_FOR_AGE, TIME_ISSUE_CODES.HOURS_UNKNOWN]);

const MINUTE_MS = 60 * 1000;

const toMinutes = (time) => {
  const [hours, minutes] = String(time).split(':').map(Number);
  return hours * 60 + minutes;
};
const overlaps = (start, end, range) => start < toMinutes(range.to) && end > toMinutes(range.from);
const isValidTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

/**
 * Whether a playdate starts too early or ends too late for the youngest child
 * @param {string} time - "HH:mm"
 * @param {number} durationMinutes
 * @param {number|null} [youngestAge]
 * @returns {boolean}
 */
export const isUnusualHour = (time, durationMinutes, youngestAge = null) => {
  if (!isValidTime(time)) return false;
  const start = toMinutes(time);
  const { EARLIEST_START, LATEST_END, LATEST_END_YOUNG } = PLAYDATE_TIME_RULES;
  const latestEnd = youngestAge !== null && youngestAge < LATEST_END_YOUNG.underAge ? LATEST_END_YOUNG.time : LATEST_END;
  return start < toMinutes(EARLIEST_START) || start + durationMinutes > toMinutes(latestEnd);
};

/**
 * Every time rule a playdate breaks, worst first: block (cannot be created), warn, info.
 * The place rules need the place (type, opening hours): without one they are skipped.
 * @param {Object} input
 * @param {string} input.date - "YYYY-MM-DD"
 * @param {string} input.time - "HH:mm"
 * @param {number} input.durationMinutes
 * @param {Array<number>} [input.ages] - Ages of every child of the playdate
 * @param {{ placeType?: string|null, openingHours?: string, coordinates?: number[] }|null} [input.place]
 * @param {Date} [input.now]
 * @returns {Array<{ code: string, severity: 'block'|'warn'|'info', params?: Object }>}
 */
export const evaluateTimeIssues = ({ date, time, durationMinutes, ages = [], place = null, now = new Date() }) => {
  if (!isValidDate(date) || !isValidTime(time)) return [];
  const issues = [];
  const add = (code, severity, params) => issues.push({ code, severity, ...(params ? { params } : {}) });

  const knownAges = ages.filter((age) => typeof age === 'number' && !Number.isNaN(age));
  const youngestAge = knownAges.length ? Math.min(...knownAges) : null;
  const duration = durationMinutes || 60;
  const start = toMinutes(time);
  const end = start + duration;
  const startsAt = getScheduledStart(new Date(date), time);
  const endsAt = new Date(startsAt.getTime() + duration * MINUTE_MS);
  const rules = PLAYDATE_TIME_RULES;

  if (startsAt <= now) add(TIME_ISSUE_CODES.PAST_DATE, TIME_ISSUE_SEVERITY.BLOCK);
  if (isUnusualHour(time, duration, youngestAge)) add(TIME_ISSUE_CODES.UNUSUAL_HOUR, TIME_ISSUE_SEVERITY.WARN);
  if (youngestAge !== null && youngestAge <= rules.NAP.maxAge && overlaps(start, end, rules.NAP)) {
    add(TIME_ISSUE_CODES.NAP_TIME, TIME_ISSUE_SEVERITY.WARN);
  }
  if (
    youngestAge !== null &&
    youngestAge >= rules.SCHOOL.minAge &&
    dayTypeOf(date) === 'weekday' &&
    rules.SCHOOL.ranges.some((range) => overlaps(start, end, range))
  ) {
    add(TIME_ISSUE_CODES.SCHOOL_HOURS, TIME_ISSUE_SEVERITY.WARN);
  }
  const lengthCap = youngestAge === null ? null : rules.MAX_LENGTH_BY_AGE.find((cap) => youngestAge < cap.underAge);
  if (lengthCap && duration > lengthCap.maxMinutes) {
    add(TIME_ISSUE_CODES.TOO_LONG_FOR_AGE, TIME_ISSUE_SEVERITY.WARN, { maxMinutes: lengthCap.maxMinutes });
  }
  if (rules.MEALS.some((range) => overlaps(start, end, range))) add(TIME_ISSUE_CODES.MEAL_TIME, TIME_ISSUE_SEVERITY.INFO);
  const notice = startsAt.getTime() - now.getTime();
  if (notice > 0 && notice < rules.SHORT_NOTICE_HOURS * 60 * MINUTE_MS) add(TIME_ISSUE_CODES.SHORT_NOTICE, TIME_ISSUE_SEVERITY.INFO);
  if (rules.HOLIDAYS.includes(date.slice(5, 10))) add(TIME_ISSUE_CODES.HOLIDAY, TIME_ISSUE_SEVERITY.INFO);

  if (place) {
    const opening = checkPlaceOpeningHours(place.openingHours, startsAt, endsAt, place.coordinates);
    if (opening.isKnown && !opening.isOpen) add(TIME_ISSUE_CODES.PLACE_CLOSED, TIME_ISSUE_SEVERITY.BLOCK);
    else if (opening.isKnown && opening.closesSoon) add(TIME_ISSUE_CODES.PLACE_CLOSES_EARLY, TIME_ISSUE_SEVERITY.WARN);
    else if (!opening.isKnown && HOURS_EXPECTED_PLACE_TYPES.includes(place.placeType)) {
      add(TIME_ISSUE_CODES.HOURS_UNKNOWN, TIME_ISSUE_SEVERITY.INFO);
    }
    if (OUTDOOR_PLACE_TYPES.includes(place.placeType) && end > toMinutes(rules.OUTDOOR_DARK_AFTER)) {
      add(TIME_ISSUE_CODES.OUTDOOR_AFTER_DARK, TIME_ISSUE_SEVERITY.WARN);
    }
  }

  const order = { block: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
};

/**
 * Whether a suggested start time may be offered: no block or warn rule about the slot itself
 * (a too long playdate is about its duration, the parent still needs a time)
 * @param {Array<Object>} issues - evaluateTimeIssues result
 * @returns {boolean}
 */
export const isSuggestableSlot = (issues) =>
  !issues.some((issue) => issue.severity !== TIME_ISSUE_SEVERITY.INFO && !SLOT_INDEPENDENT_CODES.has(issue.code));
