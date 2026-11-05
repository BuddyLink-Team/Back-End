import { getScheduledStart } from '../../shared/helpers/date.helper.js';
import { PLAYDATE_RULES, PLACE_TYPE_MIN_AGE } from '../playdate/playdate.constants.js';
import { checkPlaceOpeningHours } from '../playdate/playdate-suggestion.rules.js';
import { PLAYDATE_ACTIVITIES, GENERIC_GAMES } from '../playdate/playdate.activities.js';
import { evaluateSafetyRules } from './safety-rules.js';
import {
  AI_PLAN_STATUS,
  AI_STEPS,
  AI_CONFIRM_STEP,
  AI_LIMITS,
  AI_AGENDA_NOTE_HEADER,
  AI_SAFETY_NOTE_HEADER,
  AI_EXTRA_NOTE_HEADER,
  AI_DRAFT_WARNING_CODES,
  AI_WARNING_SEVERITY,
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
 * Whether a playdate starts too early or ends too late for children (AI_PLAYDATE_HOURS, age-aware)
 */
export const isUnusualHour = (time, durationMinutes, youngestAge = null) => {
  if (!isValidTime(time)) return false;
  const start = toMinutes(time);
  const latestEnd = youngestAge !== null && youngestAge < 5 ? toMinutes('20:00') : toMinutes(AI_PLAYDATE_HOURS.LATEST_END);
  return start < toMinutes(AI_PLAYDATE_HOURS.EARLIEST_START) || start + durationMinutes > latestEnd;
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
  safetyAcknowledged: false, // checkbox confirmed for high-risk activities
  safetyNotes: [],
  itemsToBring: [],
  hasHighRisk: false,
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
 * Playdate note: the AI agenda as a numbered list, safety precautions, then the parent's own note,
 * under their respective headers (BUD-49 B1).
 * @param {string[]} agenda
 * @param {string} [note]
 * @param {string[]} [safetyNotes]
 * @param {string[]} [itemsToBring]
 * @returns {string}
 */
export const buildNote = (agenda = [], note = '', safetyNotes = [], itemsToBring = []) => {
  const ownNote = String(note || '').trim();
  if (!agenda.length && (!safetyNotes || !safetyNotes.length) && (!itemsToBring || !itemsToBring.length)) {
    return ownNote;
  }
  const parts = [];

  if (agenda && agenda.length) {
    const list = [AI_AGENDA_NOTE_HEADER, ...agenda.map((item, index) => `${index + 1}. ${item}`)].join('\n');
    parts.push(list);
  }

  if (safetyNotes && safetyNotes.length) {
    const safetyList = [AI_SAFETY_NOTE_HEADER, ...safetyNotes.map((s) => `- ${s}`)].join('\n');
    parts.push(safetyList);
  }

  const extraPoints = [];
  if (itemsToBring && itemsToBring.length) {
    extraPoints.push(`Gợi ý đồ mang theo: ${itemsToBring.join(', ')}.`);
  }
  if (ownNote) {
    ownNote
      .split('\n')
      .map((point) => point.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean)
      .forEach((point) => extraPoints.push(point));
  }

  if (extraPoints.length) {
    parts.push([AI_EXTRA_NOTE_HEADER, ...extraPoints.map((point) => `- ${point}`)].join('\n'));
  }

  return parts.join('\n\n');
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

const VN_HOLIDAYS = new Set(['01-01', '30-04', '01-05', '02-09']);

/**
 * Consolidated pure rule validator for playdate drafts (BUD-49 Part C).
 * Returns array of { code, severity: 'block' | 'warn' | 'info', params }.
 * @param {Object} draft
 * @param {Object} [context]
 * @param {Date} [context.now=new Date()]
 * @param {Array<Object>} [context.children=[]]
 * @param {Array<Object>} [context.familyDistances=[]]
 * @param {Object} [context.weather]
 * @returns {Array<{ code: string, severity: 'block'|'warn'|'info', params?: Object }>}
 */
export const evaluateDraftWarnings = (
  draft,
  { now = new Date(), children = [], familyDistances = [], weather = null, preferredTimes = [] } = {}
) => {
  const warnings = [];

  const ages = [
    ...(draft.hostChild?.age != null ? [draft.hostChild.age] : []),
    ...(draft.participants || []).map((p) => p.age).filter((age) => typeof age === 'number'),
    ...children.map((c) => c.age).filter((age) => typeof age === 'number'),
  ];
  const youngestAge = ages.length ? Math.min(...ages) : null;
  const oldestAge = ages.length ? Math.max(...ages) : null;
  const totalKids = 1 + (draft.participants ? draft.participants.length : 0);

  const targetDate = draft.date || draft.scheduledDate;
  const duration = draft.durationMinutes || 60;

  // 1. TIME RULES
  if (targetDate && draft.time) {
    if (isPastSlot(targetDate, draft.time, now)) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.PAST_DATE, severity: AI_WARNING_SEVERITY.BLOCK });
    }

    if (isUnusualHour(draft.time, duration, youngestAge)) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.UNUSUAL_HOUR, severity: AI_WARNING_SEVERITY.WARN });
    }

    const startMinutes = toMinutes(draft.time);
    const endMinutes = startMinutes + duration;

    // NAP_TIME: 12:00 - 14:00 (720 - 840) for toddlers <= 4yo
    if (youngestAge !== null && youngestAge <= 4) {
      if (startMinutes < 840 && endMinutes > 720) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.NAP_TIME, severity: AI_WARNING_SEVERITY.WARN });
      }
    }

    // SCHOOL_HOURS: 07:30-11:30 or 13:30-16:30 on weekdays for kids >= 6
    if (youngestAge !== null && youngestAge >= 6) {
      const dayOfWeek = new Date(targetDate).getDay();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      if (isWeekday) {
        const morningSchool = startMinutes < 690 && endMinutes > 450;
        const afternoonSchool = startMinutes < 990 && endMinutes > 810;
        if (morningSchool || afternoonSchool) {
          warnings.push({ code: AI_DRAFT_WARNING_CODES.SCHOOL_HOURS, severity: AI_WARNING_SEVERITY.WARN });
        }
      }
    }

    // TOO_LONG_FOR_AGE: > 90m for < 3yo, or > 180m for < 6yo
    if (youngestAge !== null) {
      if (youngestAge < 3 && draft.durationMinutes > 90) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.TOO_LONG_FOR_AGE, severity: AI_WARNING_SEVERITY.WARN });
      } else if (youngestAge < 6 && draft.durationMinutes > 180) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.TOO_LONG_FOR_AGE, severity: AI_WARNING_SEVERITY.WARN });
      }
    }

    // MEAL_TIME: lunch (11:30 - 13:00 / 690 - 780), dinner (18:00 - 19:30 / 1080 - 1170)
    if ((startMinutes < 780 && endMinutes > 690) || (startMinutes < 1170 && endMinutes > 1080)) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.MEAL_TIME, severity: AI_WARNING_SEVERITY.INFO });
    }

    // SHORT_NOTICE: less than 4h from now
    try {
      const startDateTime = getScheduledStart(new Date(targetDate), draft.time);
      const diffMs = startDateTime.getTime() - now.getTime();
      if (diffMs > 0 && diffMs < 4 * 60 * 60 * 1000) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.SHORT_NOTICE, severity: AI_WARNING_SEVERITY.INFO });
      }
    } catch (_e) {
      // Ignore invalid date/time calculations
    }

    // HOLIDAY: VN holidays
    if (typeof targetDate === 'string' && targetDate.length >= 10) {
      const monthDay = targetDate.slice(5, 10); // "MM-DD"
      if (VN_HOLIDAYS.has(monthDay)) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.HOLIDAY, severity: AI_WARNING_SEVERITY.INFO });
      }
    }
  }

  // 2. PLACE RULES
  if (draft.location) {
    const loc = draft.location;
    const placeType = loc.placeType || loc.type;

    if (targetDate && draft.time && loc.openingHours) {
      try {
        const start = getScheduledStart(new Date(targetDate), draft.time);
        const end = new Date(start.getTime() + duration * 60 * 1000);
        const ohCheck = checkPlaceOpeningHours(loc.openingHours, start, end, loc.coordinates);
        if (ohCheck.isKnown) {
          if (!ohCheck.isOpen) {
            warnings.push({ code: AI_DRAFT_WARNING_CODES.PLACE_CLOSED, severity: AI_WARNING_SEVERITY.BLOCK });
          } else if (ohCheck.closesSoon) {
            warnings.push({ code: AI_DRAFT_WARNING_CODES.PLACE_CLOSES_EARLY, severity: AI_WARNING_SEVERITY.WARN });
          }
        }
      } catch (_e) {
        // Ignore opening_hours parse errors
      }
    } else if (placeType && ['kids_cafe', 'sports_center', 'workshop'].includes(placeType) && !loc.openingHours) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.HOURS_UNKNOWN, severity: AI_WARNING_SEVERITY.INFO });
    }

    // OUTDOOR_AFTER_DARK: outdoor place after 18:00
    if ((placeType === 'park' || placeType === 'playground') && draft.time) {
      const endMinutes = toMinutes(draft.time) + draft.durationMinutes;
      if (endMinutes > 18 * 60) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.OUTDOOR_AFTER_DARK, severity: AI_WARNING_SEVERITY.WARN });
      }
    }

    // PLACE_AGE: place min age > youngest age
    if (youngestAge !== null && placeType && PLACE_TYPE_MIN_AGE[placeType]) {
      if (youngestAge < PLACE_TYPE_MIN_AGE[placeType]) {
        warnings.push({
          code: AI_DRAFT_WARNING_CODES.PLACE_AGE,
          severity: AI_WARNING_SEVERITY.WARN,
          params: { requiredAge: PLACE_TYPE_MIN_AGE[placeType] },
        });
      }
    }

    // ACTIVITY_PLACE_MISMATCH
    if (draft.activity?.placeTypes?.length && placeType) {
      if (!draft.activity.placeTypes.includes(placeType)) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.ACTIVITY_PLACE_MISMATCH, severity: AI_WARNING_SEVERITY.WARN });
      }
    }

    // FAR_PLACE: for ANY participating family
    const allDistances = [...(loc.familyDistances || []), ...familyDistances];
    const farFamily = allDistances.find((f) => Number.isFinite(f.distanceKm) && f.distanceKm > AI_LIMITS.FAR_PLACE_KM);
    if (farFamily) {
      warnings.push({
        code: AI_DRAFT_WARNING_CODES.FAR_PLACE,
        severity: AI_WARNING_SEVERITY.WARN,
        params: { distanceKm: farFamily.distanceKm, familyLabel: farFamily.label },
      });
    }
  }

  // 3. AGENDA & SAFETY
  if (draft.agenda && draft.agenda.length) {
    if (draft.durationMinutes > 120 && draft.agenda.length === 1) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.AGENDA_TOO_THIN, severity: AI_WARNING_SEVERITY.INFO });
    }

    const placeType = draft.location?.placeType || draft.location?.type;
    const allKnown = [
      ...(draft.location?.attractions || []),
      ...PLAYDATE_ACTIVITIES,
      ...GENERIC_GAMES,
    ];

    let totalAgendaMinutes = 0;
    let hasItemAgeMismatch = false;
    let hasPlaceMismatch = false;

    for (const agendaItem of draft.agenda) {
      const text = String(agendaItem).toLowerCase();
      const matched = allKnown.find((k) => {
        const title = (k.title || k.name || '').toLowerCase();
        return title && (text.includes(title) || title.includes(text.slice(0, 10)));
      });

      const itemDuration = matched?.durationMinutes || matched?.defaultMinutes || (youngestAge !== null && youngestAge < 4 ? 20 : 25);
      totalAgendaMinutes += itemDuration;

      if (matched) {
        if (matched.minAge != null && youngestAge !== null && youngestAge < matched.minAge) {
          hasItemAgeMismatch = true;
        }
        if (matched.maxAge != null && oldestAge !== null && oldestAge > matched.maxAge) {
          hasItemAgeMismatch = true;
        }

        if (placeType && Array.isArray(matched.placeTypes) && matched.placeTypes.length > 0) {
          if (!matched.placeTypes.includes(placeType)) {
            hasPlaceMismatch = true;
          }
        }
      }
    }

    if (draft.durationMinutes && totalAgendaMinutes > draft.durationMinutes) {
      warnings.push({
        code: AI_DRAFT_WARNING_CODES.AGENDA_OVER_TIME,
        severity: AI_WARNING_SEVERITY.WARN,
        params: { totalMinutes: totalAgendaMinutes, durationMinutes: draft.durationMinutes },
      });
    }

    if (hasItemAgeMismatch) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.ITEM_AGE, severity: AI_WARNING_SEVERITY.WARN });
    }

    if (hasPlaceMismatch) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.ITEM_NOT_AT_PLACE, severity: AI_WARNING_SEVERITY.WARN });
    }

    const safety = evaluateSafetyRules({
      activityTitle: draft.activity?.title || '',
      agenda: draft.agenda,
      placeType: draft.location?.placeType || draft.location?.type,
      youngestAge,
      totalChildren: totalKids,
    });

    if (safety.hasHighRisk || draft.hasHighRisk) {
      const severity = draft.safetyAcknowledged ? AI_WARNING_SEVERITY.WARN : AI_WARNING_SEVERITY.BLOCK;
      warnings.push({ code: AI_DRAFT_WARNING_CODES.SAFETY_HIGH_RISK, severity });
    }
  }

  // 4. PARTICIPANTS
  if (oldestAge !== null && youngestAge !== null && oldestAge - youngestAge > 3) {
    warnings.push({
      code: AI_DRAFT_WARNING_CODES.AGE_GAP,
      severity: AI_WARNING_SEVERITY.WARN,
      params: { gap: oldestAge - youngestAge },
    });
  }

  if (totalKids > 6) {
    warnings.push({
      code: AI_DRAFT_WARNING_CODES.GROUP_TOO_LARGE,
      severity: AI_WARNING_SEVERITY.WARN,
      params: { count: totalKids },
    });
  }

  if (preferredTimes && Array.isArray(preferredTimes) && preferredTimes.length > 0 && draft.time) {
    const isPreferred = preferredTimes.some((slot) => slot?.time === draft.time || slot === draft.time);
    if (!isPreferred) {
      warnings.push({ code: AI_DRAFT_WARNING_CODES.NOT_PREFERRED_TIME, severity: AI_WARNING_SEVERITY.INFO });
    }
  }

  if (draft.participants && draft.participants.length > 0 && draft.hostChild) {
    const hostInterests = (draft.hostChild.interests || []).map((i) => String(i).toLowerCase());
    const participantInterests = draft.participants.map((p) => (p.interests || []).map((i) => String(i).toLowerCase()));
    const allHaveInterests = hostInterests.length > 0 && participantInterests.every((list) => list.length > 0);
    if (allHaveInterests) {
      const shared = hostInterests.some((hi) =>
        participantInterests.every((list) => list.some((pi) => pi.includes(hi) || hi.includes(pi)))
      );
      if (!shared) {
        warnings.push({ code: AI_DRAFT_WARNING_CODES.NO_SHARED_INTEREST, severity: AI_WARNING_SEVERITY.INFO });
      }
    }
  }

  // 5. WEATHER
  if (weather && (weather.isRaining || (weather.precipitationProbability && weather.precipitationProbability > 50))) {
    warnings.push({ code: AI_DRAFT_WARNING_CODES.BAD_WEATHER, severity: AI_WARNING_SEVERITY.WARN });
  }

  return warnings;
};

export const highestSeverityWarning = (warnings = []) => {
  const priority = { [AI_WARNING_SEVERITY.BLOCK]: 3, [AI_WARNING_SEVERITY.WARN]: 2, [AI_WARNING_SEVERITY.INFO]: 1 };
  return [...warnings].sort((a, b) => (priority[b.severity] || 0) - (priority[a.severity] || 0))[0] || null;
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
      [AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT, AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND].includes(warning.code)
  );

  const ageGaps = draft.participants.flatMap((participant) =>
    (participant.warnings || [])
      .filter((warning) => warning.code === AI_DRAFT_WARNING_CODES.AGE_GAP)
      .map((warning) => ({ ...warning, childId: participant.childId }))
  );

  const evaluated = evaluateDraftWarnings(draft, { now, weather: draft.weather });

  const seen = new Set(ageGaps.map((w) => w.code));
  draft.warnings = [
    ...kept,
    ...ageGaps,
    ...evaluated.filter((w) => {
      if (seen.has(w.code)) return false;
      seen.add(w.code);
      return true;
    }),
  ];

  const allChildrenAges = [
    draft.hostChild?.age,
    ...(draft.participants || []).map((p) => p.age ?? p.child?.age),
  ].filter((a) => typeof a === 'number' && !Number.isNaN(a));
  const youngestAge = allChildrenAges.length ? Math.min(...allChildrenAges) : null;

  const safety = evaluateSafetyRules({
    activityTitle: draft.activity?.title || '',
    agenda: draft.agenda,
    placeType: draft.location?.placeType || draft.location?.type,
    youngestAge,
    totalChildren: 1 + (draft.participants?.length || 0),
  });
  draft.safetyNotes = safety.safetyNotes;
  draft.itemsToBring = safety.itemsToBring;
  draft.hasHighRisk = safety.hasHighRisk;

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
    safetyAcknowledged: Boolean(draft.safetyAcknowledged),
    safetyNotes: draft.safetyNotes || [],
    itemsToBring: draft.itemsToBring || [],
    hasHighRisk: Boolean(draft.hasHighRisk),
    extraNote: draft.note || '',
    note: buildNote(draft.agenda, draft.note, draft.safetyNotes, draft.itemsToBring),
    warnings: draft.warnings,
  };
};
