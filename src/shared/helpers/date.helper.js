import env from '../../config/env.js';

const DEFAULT_TIME_ZONE = env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh';

/**
 * Calendar parts of an instant as seen in a time zone.
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
export const getZonedParts = (date, timeZone = DEFAULT_TIME_ZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const value = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

/**
 * Build the instant of a wall-clock time in a time zone.
 * @param {{ year: number, month: number, day: number }} day - month is 1-based
 * @param {number} hour
 * @param {number} minute
 * @param {string} [timeZone]
 * @returns {Date}
 */
const zonedWallTimeToDate = ({ year, month, day }, hour, minute, timeZone = DEFAULT_TIME_ZONE) => {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Offset of the zone at that moment (e.g. +7h for Asia/Ho_Chi_Minh)
  const zoned = getZonedParts(new Date(asUtc), timeZone);
  const offset = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute) - asUtc;
  return new Date(asUtc - offset);
};

/**
 * Instant when a playdate starts: its calendar date (as seen in the business time zone)
 * combined with its start time "HH:mm".
 * @param {Date|string} scheduledDate
 * @param {string} [time]
 * @param {string} [timeZone]
 * @returns {Date}
 */
export const getScheduledStart = (scheduledDate, time, timeZone = DEFAULT_TIME_ZONE) => {
  const day = getZonedParts(new Date(scheduledDate), timeZone);
  const match = String(time || '').match(/^(\d{2}):(\d{2})/);
  const hour = match ? Number(match[1]) : 0;
  const minute = match ? Number(match[2]) : 0;
  return zonedWallTimeToDate(day, hour, minute, timeZone);
};

/**
 * Instant of 00:00 today in the business time zone.
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {Date}
 */
export const getStartOfZonedDay = (now = new Date(), timeZone = DEFAULT_TIME_ZONE) =>
  zonedWallTimeToDate(getZonedParts(now, timeZone), 0, 0, timeZone);
