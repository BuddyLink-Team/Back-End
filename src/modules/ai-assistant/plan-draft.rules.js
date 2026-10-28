import { getScheduledStart } from '../../shared/helpers/date.helper.js';
import { PLAYDATE_RULES } from '../playdate/playdate.constants.js';
import {
  AI_PLAN_STATUS,
  AI_STEPS,
  AI_CONFIRM_STEP,
  AI_LIMITS,
  AI_AGENDA_NOTE_HEADER,
  AI_EXTRA_NOTE_HEADER,
  AI_DRAFT_WARNING_CODES,
  AI_PLAYDATE_HOURS,
} from './ai-assistant.constants.js';

/**
 * Pure rules of the playdate being planned in a chat session (no I/O).
 * The draft is stored on the session and mapped 1:1 to the POST /playdates body on confirm.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isValidDate = (value) => DATE_REGEX.test(String(value || '')) && !Number.isNaN(new Date(value).getTime());
export const isValidTime = (value) => TIME_REGEX.test(String(value || ''));

const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};
const toClock = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * End time "HH:mm" of a start time plus a duration (wraps past midnight)
 * @returns {string|null}
 */
export const endTimeOf = (time, durationMinutes) => (isValidTime(time) ? toClock(toMinutes(time) + durationMinutes) : null);

/**
 * Whether a playdate starts too early or ends too late for children (AI_PLAYDATE_HOURS)
 */
export const isUnusualHour = (time, durationMinutes) => {
  if (!isValidTime(time)) return false;
  const start = toMinutes(time);
  return start < toMinutes(AI_PLAYDATE_HOURS.EARLIEST_START) || start + durationMinutes > toMinutes(AI_PLAYDATE_HOURS.LATEST_END);
};

// Agenda items that are not an activity of their own (the parent asked for concrete games only)
const FILLER_AGENDA_REGEX = /làm quen|khởi động|chào hỏi|giới thiệu|tạm biệt|chia tay|tập trung|ổn định/i;

/** @returns {Object} A new, empty draft */
export const emptyDraft = () => ({
  status: AI_PLAN_STATUS.COLLECTING,
  hostChild: null, // { childId, displayName }
  preferredDate: null, // a day the parent asked for, before a time is picked
  date: null,
  time: null,
  durationMinutes: PLAYDATE_RULES.DEFAULT_DURATION_MINUTES,
  participants: [], // { parentId, childId, childName, parentName, warnings }
  pendingParticipants: null, // { childIds, names } given before the host child was known
  playmatesSkipped: false,
  activity: null, // { key, title, placeTypes }
  location: null, // { id, name, address, placeId, coordinates }
  agenda: [],
  agendaConfirmed: false, // the parent reviewed the main activities
  extraDone: false, // the parent answered "anything else?"
  note: '',
  warnings: [],
});

/**
 * Duration in the range accepted by POST /playdates
 * @param {*} minutes
 * @returns {number}
 */
export const clampDuration = (minutes) => {
  const value = parseInt(minutes, 10);
  if (!Number.isFinite(value)) return PLAYDATE_RULES.DEFAULT_DURATION_MINUTES;
  return Math.min(PLAYDATE_RULES.MAX_DURATION_MINUTES, Math.max(PLAYDATE_RULES.MIN_DURATION_MINUTES, value));
};

/**
 * 3-5 short main activities, no duplicates
 * @param {*} agenda
 * @returns {string[]}
 */
export const normalizeAgenda = (agenda) => {
  if (!Array.isArray(agenda)) return [];
  const items = agenda
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, AI_LIMITS.AGENDA_ITEM_MAX_LENGTH))
    .filter((item) => item && !FILLER_AGENDA_REGEX.test(item));
  return [...new Set(items)].slice(0, AI_LIMITS.MAX_AGENDA_ITEMS);
};

/**
 * Playdate note: the AI agenda as a numbered list, then the parent's own note under its header,
 * one "- " line per line of the request, so each point stays apart
 * @param {string[]} agenda
 * @param {string} [note]
 * @returns {string}
 */
export const buildNote = (agenda = [], note = '') => {
  const ownNote = String(note || '').trim();
  if (!agenda.length) return ownNote;
  const list = [AI_AGENDA_NOTE_HEADER, ...agenda.map((item, index) => `${index + 1}. ${item}`)].join('\n');
  if (!ownNote) return list;
  const points = ownNote
    .split('\n')
    .map((point) => point.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
  return `${list}\n\n${[AI_EXTRA_NOTE_HEADER, ...points.map((point) => `- ${point}`)].join('\n')}`;
};

/**
 * Whether a date + time is already past (in the business time zone)
 */
export const isPastSlot = (date, time, now = new Date()) =>
  isValidDate(date) && isValidTime(time) && getScheduledStart(new Date(date), time) <= now;

/**
 * First step still missing, or 'confirm' when the draft can be confirmed
 * @param {Object} draft
 * @returns {string}
 */
export const nextMissingStep = (draft) => {
  if (!draft?.hostChild) return AI_STEPS.CHILD;
  if (!draft.date || !draft.time) return AI_STEPS.TIME;
  if (!draft.participants.length && !draft.playmatesSkipped) return AI_STEPS.PLAYMATES;
  if (!draft.activity) return AI_STEPS.ACTIVITY;
  if (!draft.location) return AI_STEPS.PLACE;
  if (!draft.agendaConfirmed) return AI_STEPS.AGENDA;
  if (!draft.extraDone) return AI_STEPS.EXTRA;
  return AI_CONFIRM_STEP;
};

/**
 * Status and warnings derived from the current fields
 * @param {Object} draft
 * @param {Date} [now]
 * @returns {Object} The same draft, updated
 */
export const refreshDraft = (draft, now = new Date()) => {
  const step = nextMissingStep(draft);
  draft.status = step === AI_CONFIRM_STEP ? AI_PLAN_STATUS.READY : AI_PLAN_STATUS.COLLECTING;

  const kept = (draft.warnings || []).filter(
    (warning) =>
      ![AI_DRAFT_WARNING_CODES.PAST_DATE, AI_DRAFT_WARNING_CODES.AGE_GAP, AI_DRAFT_WARNING_CODES.UNUSUAL_HOUR].includes(
        warning.code
      )
  );
  const ageGaps = draft.participants.flatMap((participant) =>
    (participant.warnings || [])
      .filter((warning) => warning.code === AI_DRAFT_WARNING_CODES.AGE_GAP)
      .map((warning) => ({ ...warning, childId: participant.childId }))
  );
  const past = isPastSlot(draft.date, draft.time, now) ? [{ code: AI_DRAFT_WARNING_CODES.PAST_DATE }] : [];
  const unusualHour =
    draft.date && isUnusualHour(draft.time, draft.durationMinutes) ? [{ code: AI_DRAFT_WARNING_CODES.UNUSUAL_HOUR }] : [];
  draft.warnings = [...kept, ...ageGaps, ...past, ...unusualHour];
  return draft;
};

/**
 * Short text of the draft for the system prompt
 * @param {Object|null} draft
 * @returns {string}
 */
export const summarizeDraft = (draft) => {
  if (!draft) return 'No playdate is being planned.';
  const lines = [
    `Child: ${draft.hostChild ? draft.hostChild.displayName : '(missing)'}`,
    `Time: ${draft.date && draft.time ? `${draft.date} ${draft.time}, ${draft.durationMinutes} min` : draft.preferredDate ? `(day ${draft.preferredDate}, time missing)` : '(missing)'}`,
    `Playmates: ${draft.participants.length ? draft.participants.map((p) => p.childName).join(', ') : draft.playmatesSkipped ? '(none, skipped)' : '(missing)'}`,
    `Activity: ${draft.activity ? draft.activity.title : '(missing)'}`,
    `Place: ${draft.location ? draft.location.name : '(missing)'}`,
    `Agenda: ${draft.agenda.length ? draft.agenda.join(' | ') : '(none yet)'}${draft.agendaConfirmed ? ' (reviewed by the parent)' : ''}`,
    `Note: ${draft.note || '(none)'}`,
    `Warnings: ${(draft.warnings || []).map((warning) => warning.code).join(', ') || '(none)'}`,
    `Status: ${draft.status}, next step: ${nextMissingStep(draft)}`,
  ];
  return lines.join('\n');
};

/**
 * Draft as returned to the client: the POST /playdates body plus display fields
 * @param {Object|null} draft
 * @returns {Object|null}
 */
export const toDraftResponse = (draft) => {
  if (!draft) return null;
  return {
    status: draft.status,
    nextStep: nextMissingStep(draft),
    hostChild: draft.hostChild,
    hostChildId: draft.hostChild?.childId || null,
    scheduledDate: draft.date,
    time: draft.time,
    endTime: endTimeOf(draft.time, draft.durationMinutes),
    durationMinutes: draft.durationMinutes,
    activity: draft.activity?.title || '',
    agenda: draft.agenda,
    location: draft.location
      ? {
          name: draft.location.name,
          // POST /playdates requires an address; some OpenStreetMap places have none
          address: draft.location.address || draft.location.name,
          placeId: draft.location.placeId || undefined,
          coordinates: Array.isArray(draft.location.coordinates)
            ? { type: 'Point', coordinates: draft.location.coordinates }
            : undefined,
        }
      : null,
    // Details of the place for the summary card (type, distance to each family, opening hours, map links)
    placeDetails: draft.location
      ? {
          placeType: draft.location.placeType || null,
          openingHours: draft.location.openingHours || '',
          osmUrl: draft.location.osmUrl || null,
          familyDistances: draft.location.familyDistances || [],
        }
      : null,
    participants: draft.participants.map(({ parentId, childId, childName, parentName }) => ({
      parentId,
      childId,
      childName,
      parentName,
    })),
    // The parent's own note alone, for display (`note` is what POST /playdates stores)
    extraNote: draft.note || '',
    note: buildNote(draft.agenda, draft.note),
    warnings: draft.warnings,
  };
};
