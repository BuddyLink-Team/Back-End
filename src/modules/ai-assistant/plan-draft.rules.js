import { getScheduledStart } from '../../shared/helpers/date.helper.js';
import {
  PLAYDATE_RULES,
  PLAYDATE_TIME_RULES,
  PLACE_TYPE_MIN_AGE,
  HOURS_EXPECTED_PLACE_TYPES,
  INDOOR_PLACE_TYPES,
} from '../playdate/playdate.constants.js';
import { evaluateTimeIssues, isUnusualHour } from '../playdate/playdate-time.rules.js';
import {
  PLAYDATE_ACTIVITIES,
  GENERIC_GAMES,
  normalizeText,
  isKnownAgendaItem,
  gameMinutesFor,
  namesGame,
  agendaSizeFor,
  activityGamesFor,
} from '../playdate/playdate.activities.js';
import { evaluateSafetyRules, isBadWeather, isIndoorPlace } from './safety-rules.js';
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

// Shared with the time suggestions and the Create Playdate form (playdate-time.rules.js)
export { isUnusualHour };

// Agenda items that are not an activity of their own (the parent asked for concrete games only)
const FILLER_AGENDA_REGEX = /làm quen|khởi động|chào hỏi|giới thiệu|tạm biệt|chia tay|tập trung|ổn định/i;

/**
 * Every own child of the plan, main child first (drafts saved before several children only have hostChild)
 * @param {Object|null} draft
 * @returns {Array<{ childId: string, displayName: string, age?: number|null, interests?: string[] }>}
 */
export const draftHostChildren = (draft) => {
  if (draft?.hostChildren?.length) return draft.hostChildren;
  return draft?.hostChild ? [draft.hostChild] : [];
};

/** @returns {Object} A new, empty draft */
export const emptyDraft = () => ({
  status: AI_PLAN_STATUS.COLLECTING,
  hostChild: null, // main own child { childId, displayName, age, interests }: playmates are ranked for it
  hostChildren: [], // every own child who comes (hostChild first)
  preferredDate: null, // a day the parent asked for, before a time is picked
  date: null,
  time: null,
  durationMinutes: PLAYDATE_RULES.DEFAULT_DURATION_MINUTES,
  // Who set the duration: 'default' (not chosen yet, follows the children's ages), 'parent'
  durationSource: 'default',
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

// Default length of a playdate by the youngest child: toddlers tire quickly
const DEFAULT_DURATION_BY_AGE = Object.freeze([
  { underAge: 3, minutes: 60 },
  { underAge: 6, minutes: 90 },
]);

/**
 * Playdate length offered first, from the youngest child of the plan
 * @param {number|null} youngestAge
 * @returns {number}
 */
export const defaultDurationFor = (youngestAge) =>
  (youngestAge === null || youngestAge === undefined
    ? null
    : DEFAULT_DURATION_BY_AGE.find((band) => youngestAge < band.underAge)?.minutes) ?? PLAYDATE_RULES.DEFAULT_DURATION_MINUTES;

// Lengths offered on the time card, the longest one still fitting the youngest child
const DURATION_CHOICES = Object.freeze([60, 90, 120, 180]);

/**
 * Durations the parent can pick on the time card (the current one always included)
 * @param {number} current
 * @param {number|null} youngestAge
 * @returns {number[]}
 */
export const durationChoicesFor = (current, youngestAge) => {
  const cap = youngestAge === null || youngestAge === undefined
    ? null
    : PLAYDATE_TIME_RULES.MAX_LENGTH_BY_AGE.find((band) => youngestAge < band.underAge)?.maxMinutes ?? null;
  const fitting = DURATION_CHOICES.filter((minutes) => cap === null || minutes <= cap);
  return [...new Set([...(fitting.length ? fitting : [DURATION_CHOICES[0]]), current].filter(Boolean))].sort((a, b) => a - b);
};

/**
 * "45 phút", "1 giờ", "1 giờ 30 phút"
 * @param {number} minutes
 * @returns {string}
 */
export const formatDurationVi = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} phút`;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
};

/**
 * 3-5 short main activities, no duplicates
 * @param {*} agenda
 * @returns {string[]}
 */
export const normalizeAgenda = (agenda) => {
  if (!Array.isArray(agenda)) return [];
  const items = agenda
    // An item of the real attractions keeps its source link whole (BUD-49 A4)
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .map((item) => (item.startsWith('Theo thông tin trên mạng về') ? item.slice(0, AI_LIMITS.SOURCED_AGENDA_ITEM_MAX_LENGTH) : item.slice(0, AI_LIMITS.AGENDA_ITEM_MAX_LENGTH)))
    .filter((item) => item && !FILLER_AGENDA_REGEX.test(item));
  return [...new Set(items)].slice(0, AI_LIMITS.MAX_AGENDA_ITEMS);
};

// Catalog matching (A6) lives with the catalog; kept here for the callers
export { normalizeText, isKnownAgendaItem };

/**
 * Ages of every child of the plan (own children and invited ones)
 * @param {Object} draft
 * @returns {number[]}
 */
export const draftAges = (draft) =>
  [...draftHostChildren(draft), ...(draft?.participants || [])]
    .map((child) => child.age)
    .filter((age) => typeof age === 'number' && !Number.isNaN(age));

/**
 * Age of the youngest child of the plan
 * @param {Object} draft
 * @returns {number|null}
 */
export const youngestOf = (draft) => {
  const ages = draftAges(draft);
  return ages.length ? Math.min(...ages) : null;
};

/**
 * Games that fit the plan (BUD-49 A2): the range of games for its duration and youngest child
 * @param {Object} draft
 * @returns {{ min: number, max: number }}
 */
export const draftAgendaSize = (draft) => {
  const ages = draftAges(draft);
  return agendaSizeFor({ durationMinutes: draft.durationMinutes, youngestAge: ages.length ? Math.min(...ages) : null });
};

/**
 * An agenda item that is one of the real attractions of the place (Google Search), written with its source
 * (BUD-49 A4): "Theo thông tin trên mạng về {địa điểm}: {trò} ({link})". Other items are left as they are.
 * @param {string} item
 * @param {{ name?: string, attractions?: Array<{ title: string, sourceUrl?: string|null }> }} location
 * @returns {string}
 */
export const withAttractionSource = (item, location) => {
  const text = String(item || '').trim();
  if (!location?.name || text.startsWith(ATTRACTION_PREFIX)) return text;
  const attraction = (location.attractions || []).find((candidate) => namesGame(text, candidate));
  if (!attraction) return text;
  const sourced = `${ATTRACTION_PREFIX} ${location.name}: ${text}`;
  return attraction.sourceUrl ? `${sourced} (${attraction.sourceUrl})` : sourced;
};

const ATTRACTION_PREFIX = 'Theo thông tin trên mạng về';

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
  // Playmates before the time: the time step then ranks slots for every invited family ("Hợp với x/y gia đình")
  if (!draft.participants.length && !draft.playmatesSkipped) return AI_STEPS.PLAYMATES;
  if (!draft.date || !draft.time) return AI_STEPS.TIME;
  if (!draft.activity) return AI_STEPS.ACTIVITY;
  if (!draft.location) return AI_STEPS.PLACE;
  if (!draft.agendaConfirmed) return AI_STEPS.AGENDA;
  if (!draft.extraDone) return AI_STEPS.EXTRA;
  return AI_CONFIRM_STEP;
};

/**
 * Consolidated pure rule validator for playdate drafts (BUD-49 Part C).
 * Returns array of { code, severity: 'block' | 'warn' | 'info', params }.
 * @param {Object} draft
 * @param {Object} [context]
 * @param {Date} [context.now=new Date()]
 * @param {Array<Object>} [context.children=[]]
 * @param {Array<Object>} [context.familyDistances=[]]
 * @param {Object} [context.weather]
 * @param {Object} [context.slotFit] - Preferred days / time slots fit of the chosen time (draft.slotFit)
 * @returns {Array<{ code: string, severity: 'block'|'warn'|'info', params?: Object }>}
 */
export const evaluateDraftWarnings = (
  draft,
  { now = new Date(), children = [], familyDistances = [], weather = null, slotFit = null } = {}
) => {
  const warnings = [];

  const ages = [
    ...draftHostChildren(draft).map((child) => child.age).filter((age) => typeof age === 'number'),
    ...(draft.participants || []).map((p) => p.age).filter((age) => typeof age === 'number'),
    ...children.map((c) => c.age).filter((age) => typeof age === 'number'),
  ];
  const youngestAge = ages.length ? Math.min(...ages) : null;
  const oldestAge = ages.length ? Math.max(...ages) : null;
  const totalKids = Math.max(1, draftHostChildren(draft).length) + (draft.participants ? draft.participants.length : 0);

  const targetDate = draft.date || draft.scheduledDate;
  const duration = draft.durationMinutes || 60;

  // 1. TIME RULES (and the place rules that depend on the time): the same rules as the time suggestions
  const placeType = draft.location?.placeType || draft.location?.type || null;
  if (targetDate && draft.time) {
    warnings.push(
      ...evaluateTimeIssues({
        date: String(targetDate).slice(0, 10),
        time: draft.time,
        durationMinutes: duration,
        ages,
        place: draft.location
          ? { placeType, openingHours: draft.location.openingHours, coordinates: draft.location.coordinates }
          : null,
        now,
      })
    );
  } else if (draft.location && !draft.location.openingHours && HOURS_EXPECTED_PLACE_TYPES.includes(placeType)) {
    warnings.push({ code: AI_DRAFT_WARNING_CODES.HOURS_UNKNOWN, severity: AI_WARNING_SEVERITY.INFO });
  }

  // 2. PLACE RULES
  if (draft.location) {
    const loc = draft.location;

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
    // At home: fine for the indoor activities (Lego, drawing, baking…), not for a park or a pool
    const fitsHome = placeType === 'home' && draft.activity?.placeTypes?.some((type) => INDOOR_PLACE_TYPES.includes(type));
    if (draft.activity?.placeTypes?.length && placeType && !fitsHome) {
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
      ...activityGamesFor(draft.activity),
      ...PLAYDATE_ACTIVITIES,
      ...GENERIC_GAMES,
    ];

    let totalAgendaMinutes = 0;
    let hasItemAgeMismatch = false;
    let hasPlaceMismatch = false;

    for (const agendaItem of draft.agenda) {
      // The attractions of the place first: an item there is never "not at this place"
      // The game with this very name first, then any game it names
      const exact = normalizeText(agendaItem);
      const matched =
        allKnown.find((k) => normalizeText(k.title || k.name) === exact) || allKnown.find((k) => namesGame(agendaItem, k));

      // One game, not the whole playdate: catalog activities carry the usual length of a playdate
      const game = gameMinutesFor(youngestAge);
      const isAttraction = (draft.location?.attractions || []).includes(matched);
      const itemDuration = isAttraction && matched.durationMinutes ? Math.min(matched.durationMinutes, game.maxMinutes) : game.minutes;
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
      childAges: ages,
      weather,
      time: draft.time,
      durationMinutes: duration,
    });

    if (safety.hasHighRisk) {
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

  // Only the families who set preferred days and time slots count (the others are neutral, as in the time step)
  if (isCurrentSlotFit(draft, slotFit) && slotFit.parentsWithPreferences > 0 && slotFit.matchedParents < slotFit.parentsWithPreferences) {
    warnings.push({
      code: AI_DRAFT_WARNING_CODES.NOT_PREFERRED_TIME,
      severity: AI_WARNING_SEVERITY.INFO,
      params: { matchedParents: slotFit.matchedParents, totalParents: slotFit.totalParents },
    });
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
  if (isBadWeather(weather) && !isIndoorPlace(placeType)) {
    warnings.push({ code: AI_DRAFT_WARNING_CODES.BAD_WEATHER, severity: AI_WARNING_SEVERITY.WARN });
  }

  return warnings;
};

/**
 * Activity and place the model's own safety notes and items were written for (see refreshDraft)
 * @param {Object} draft
 * @returns {string}
 */
export const safetyContextKey = (draft) => `${draft?.activity?.title || ''}||${draft?.location?.name || ''}`;

/**
 * Whether the stored preference fit was computed for the current time and invitees of the draft
 * @param {Object} draft
 * @param {Object|null} slotFit
 * @returns {boolean}
 */
export const isCurrentSlotFit = (draft, slotFit) =>
  Boolean(slotFit && draft.date && draft.time && slotFit.date === draft.date && slotFit.time === draft.time && slotFit.groupKey === groupKeyOf(draft));

/**
 * Children of the plan as one key (host child first), to know when a stored fit is outdated
 * @param {Object} draft
 * @returns {string}
 */
export const groupKeyOf = (draft) =>
  [
    ...draftHostChildren(draft).map((child) => child.childId),
    ...(draft.participants || []).map((participant) => participant.childId).sort(),
  ].join(',');

/**
 * Warnings that stop the playdate from being created (severity block). The safety warning is left out:
 * the parent clears it by ticking the acknowledgement (checked on its own).
 * @param {Array<Object>} [warnings]
 * @returns {Array<Object>}
 */
export const blockingWarnings = (warnings = []) =>
  warnings.filter((warning) => warning.severity === AI_WARNING_SEVERITY.BLOCK && warning.code !== AI_DRAFT_WARNING_CODES.SAFETY_HIGH_RISK);

export const highestSeverityWarning = (warnings = []) => {
  const priority = { [AI_WARNING_SEVERITY.BLOCK]: 3, [AI_WARNING_SEVERITY.WARN]: 2, [AI_WARNING_SEVERITY.INFO]: 1 };
  return [...warnings].sort((a, b) => (priority[b.severity] || 0) - (priority[a.severity] || 0))[0] || null;
};

const PLACE_TYPE_TEXT = Object.freeze({
  park: 'công viên',
  kids_cafe: 'khu vui chơi trong nhà',
  playground: 'sân chơi',
  library: 'thư viện',
  sports_center: 'trung tâm thể thao',
  workshop: 'xưởng sáng tạo',
  home: 'nhà riêng',
});

/**
 * One warning in plain Vietnamese with its details (who, when, how far), shown on the summary card and
 * given to the model, which must never read out a code
 * @param {Object} warning
 * @param {Object} draft
 * @returns {string}
 */
export const describeWarning = (warning, draft) => {
  const params = warning.params || {};
  const place = draft?.location?.name || 'Địa điểm';
  const duration = draft?.durationMinutes;
  const opening = draft?.location?.openingHours ? ` (giờ mở cửa: ${draft.location.openingHours})` : '';
  switch (warning.code) {
    case AI_DRAFT_WARNING_CODES.PAST_DATE:
      return 'Thời gian này đã qua, bạn chọn giờ khác nhé';
    case AI_DRAFT_WARNING_CODES.UNUSUAL_HOUR:
      return `Khung ${draft?.time || ''}–${endTimeOf(draft?.time, duration) || ''} khá sớm hoặc khá muộn với các bé`;
    case AI_DRAFT_WARNING_CODES.NAP_TIME:
      return 'Trùng giờ ngủ trưa của bé nhỏ (12:00–14:00)';
    case AI_DRAFT_WARNING_CODES.SCHOOL_HOURS:
      return 'Trùng giờ học ngày thường của các bé';
    case AI_DRAFT_WARNING_CODES.TOO_LONG_FOR_AGE:
      return `Buổi chơi ${formatDurationVi(duration)} hơi dài với bé nhỏ nhất, nên tối đa ${formatDurationVi(params.maxMinutes)}`;
    case AI_DRAFT_WARNING_CODES.MEAL_TIME:
      return 'Trùng giờ ăn, nhớ chuẩn bị đồ ăn nhẹ cho các bé';
    case AI_DRAFT_WARNING_CODES.SHORT_NOTICE:
      return 'Hẹn gấp, các gia đình có thể chưa kịp sắp xếp';
    case AI_DRAFT_WARNING_CODES.HOLIDAY:
      return 'Ngày lễ, địa điểm có thể rất đông';
    case AI_DRAFT_WARNING_CODES.PLACE_CLOSED:
      return `${place} đóng cửa vào giờ này${opening}`;
    case AI_DRAFT_WARNING_CODES.PLACE_CLOSES_EARLY:
      return `${place} đóng cửa trước khi buổi chơi kết thúc${opening}`;
    case AI_DRAFT_WARNING_CODES.OUTDOOR_AFTER_DARK:
      return 'Buổi chơi ngoài trời kết thúc sau khi trời tối';
    case AI_DRAFT_WARNING_CODES.HOURS_UNKNOWN:
      return `Chưa rõ giờ mở cửa của ${place}, bạn nên gọi hỏi trước`;
    case AI_DRAFT_WARNING_CODES.PLACE_AGE:
      return `${place} thường dành cho bé từ ${params.requiredAge} tuổi`;
    case AI_DRAFT_WARNING_CODES.ACTIVITY_PLACE_MISMATCH:
      return `Hoạt động "${draft?.activity?.title || ''}" có thể không hợp với ${PLACE_TYPE_TEXT[draft?.location?.placeType] || 'địa điểm này'}`;
    case AI_DRAFT_WARNING_CODES.FAR_PLACE: {
      const km = params.distanceKm ?? warning.distanceKm;
      const who = params.familyLabel && params.familyLabel !== 'Nhà bạn' ? `nhà ${params.familyLabel}` : 'nhà bạn';
      return `${place} cách ${who} khoảng ${km} km`;
    }
    case AI_DRAFT_WARNING_CODES.AGENDA_OVER_TIME:
      return `Các trò chơi cần khoảng ${params.totalMinutes} phút, dài hơn buổi hẹn ${duration} phút`;
    case AI_DRAFT_WARNING_CODES.ITEM_AGE:
      return 'Có trò chơi chưa hợp độ tuổi của tất cả các bé';
    case AI_DRAFT_WARNING_CODES.ITEM_NOT_AT_PLACE:
      return `Có trò chơi khó chơi ở ${PLACE_TYPE_TEXT[draft?.location?.placeType] || 'địa điểm này'}`;
    case AI_DRAFT_WARNING_CODES.SAFETY_HIGH_RISK:
      return 'Hoạt động có rủi ro cao, cần người lớn giám sát sát sao';
    case AI_DRAFT_WARNING_CODES.AGENDA_TOO_THIN:
      return 'Buổi chơi dài nhưng mới có ít hoạt động';
    case AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT: {
      const name = warning.childName ? `Bé ${warning.childName}` : 'Một bé';
      const when = warning.start && warning.end ? ` lúc ${warning.start}–${warning.end}` : ' trùng giờ này';
      return warning.severity === AI_WARNING_SEVERITY.BLOCK
        ? `${name} đã có hẹn khác${when}, bạn cần đổi giờ`
        : `${name} đã có hẹn khác${when}, có thể chưa nhận lời được`;
    }
    case AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND:
      return `"${warning.value}" chưa phải bạn bè đã kết nối nên chưa mời được`;
    case AI_DRAFT_WARNING_CODES.AGE_GAP: {
      const gap = params.gap ?? warning.gap;
      return gap ? `Các bé chênh nhau ${gap} tuổi, nên chọn trò hợp cả nhóm` : 'Các bé chênh tuổi khá nhiều';
    }
    case AI_DRAFT_WARNING_CODES.GROUP_TOO_LARGE:
      return `Nhóm ${params.count} bé khá đông, cần thêm người lớn hỗ trợ`;
    case AI_DRAFT_WARNING_CODES.NOT_PREFERRED_TIME:
      return `Giờ này hợp buổi rảnh (trong hồ sơ) của ${params.matchedParents}/${params.totalParents} gia đình`;
    case AI_DRAFT_WARNING_CODES.NO_SHARED_INTEREST:
      return 'Các bé chưa có sở thích chung nào trong hồ sơ';
    case AI_DRAFT_WARNING_CODES.BAD_WEATHER:
      return draft?.weather?.scope === 'slot'
        ? 'Dự báo có mưa đúng giờ chơi, nên ưu tiên chỗ trong nhà'
        : 'Dự báo ngày này có mưa, nên ưu tiên chỗ trong nhà';
    default:
      return '';
  }
};

/**
 * Warnings with their text, for the client and the model
 * @param {Object} draft
 * @returns {Array<Object>}
 */
export const describedWarnings = (draft) =>
  (draft?.warnings || []).map((warning) => ({ ...warning, message: describeWarning(warning, draft) }));

/**
 * Status and warnings derived from the current fields
 * @param {Object} draft
 * @param {Date} [now]
 * @returns {Object} The same draft, updated
 */
export const refreshDraft = (draft, now = new Date()) => {
  const step = nextMissingStep(draft);
  draft.status = step === AI_CONFIRM_STEP ? AI_PLAN_STATUS.READY : AI_PLAN_STATUS.COLLECTING;

  const allChildrenAges = [
    ...draftHostChildren(draft).map((child) => child.age),
    ...(draft.participants || []).map((p) => p.age ?? p.child?.age),
  ].filter((a) => typeof a === 'number' && !Number.isNaN(a));
  const youngestAge = allChildrenAges.length ? Math.min(...allChildrenAges) : null;

  // Reset safety acknowledgement if agenda or activity changed
  const currentSafetyKey = `${draft.activity?.title || ''}||${(draft.agenda || []).join('||')}`;
  if (draft._lastSafetyKey !== undefined && draft._lastSafetyKey !== currentSafetyKey) {
    draft.safetyAcknowledged = false;
  }
  draft._lastSafetyKey = currentSafetyKey;

  const safety = evaluateSafetyRules({
    activityTitle: draft.activity?.title || '',
    agenda: draft.agenda,
    placeType: draft.location?.placeType || draft.location?.type,
    youngestAge,
    totalChildren: Math.max(1, draftHostChildren(draft).length) + (draft.participants?.length || 0),
    childAges: draftAges(draft),
    weather: draft.weather,
    time: draft.time,
    durationMinutes: draft.durationMinutes,
  });
  // What the model added was written for one activity at one place: it is dropped when either changes
  if (draft._extraSafetyKey !== safetyContextKey(draft)) {
    draft.extraSafetyNotes = [];
    draft.extraItemsToBring = [];
  }
  // The model may add precautions (extraSafetyNotes), never remove the rule-based ones (B1)
  draft.safetyNotes = [...new Set([...safety.safetyNotes, ...(draft.extraSafetyNotes || [])])];
  draft.requiredAdults = safety.requiredAdults;
  const ruleItems = new Set(safety.itemsToBring.map((item) => normalizeText(item)));
  draft.itemsToBring = [...safety.itemsToBring, ...(draft.extraItemsToBring || []).filter((item) => !ruleItems.has(normalizeText(item)))];
  draft.hasHighRisk = safety.hasHighRisk;

  const kept = (draft.warnings || []).filter(
    (warning) =>
      [AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT, AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND].includes(warning.code)
  );

  const ageGaps = draft.participants.flatMap((participant) =>
    (participant.warnings || [])
      .filter((warning) => warning.code === AI_DRAFT_WARNING_CODES.AGE_GAP)
      .map((warning) => ({ ...warning, childId: participant.childId }))
  );

  const evaluated = evaluateDraftWarnings(draft, {
    now,
    weather: draft.weather,
    slotFit: draft.slotFit || null,
  });

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

  return draft;
};

/**
 * Forecast of the playdate for the system prompt
 * @param {Object|null} weather
 * @returns {string}
 */
const describeForecast = (weather) => {
  if (!weather) return '(unknown)';
  const parts = [
    isBadWeather(weather) ? 'rain' : 'dry',
    `${Math.round(weather.precipitationProbability || 0)}% chance of rain`,
    Number.isFinite(weather.maxTemp) ? `up to ${Math.round(weather.maxTemp)}°C` : null,
    weather.scope === 'slot' ? 'during the playdate hours' : 'that day',
    weather.basis === 'home' ? "around the parent's home (no place yet)" : null,
  ];
  return parts.filter(Boolean).join(', ');
};

/**
 * Short text of the draft for the system prompt
 * @param {Object|null} draft
 * @returns {string}
 */
export const summarizeDraft = (draft) => {
  if (!draft) return 'No playdate is being planned.';
  const highest = highestSeverityWarning(draft.warnings || []);
  const severityText = { block: 'must fix', warn: 'warning', info: 'info' };
  const warningLines = describedWarnings(draft)
    .filter((warning) => warning.message)
    .map((warning) => `  - [${severityText[warning.severity] || 'warning'}] ${warning.message}`);
  const lines = [
    `Children: ${draft.hostChild ? draftHostChildren(draft).map((child) => `${child.displayName}${child.age != null ? ` (${child.age} tuổi)` : ''}`).join(', ') : '(missing)'}`,
    `Time: ${draft.date && draft.time ? `${draft.date} ${draft.time}-${endTimeOf(draft.time, draft.durationMinutes)}, ${draft.durationMinutes} min${draft.durationSource === 'parent' ? ' (duration chosen by the parent)' : ''}` : draft.preferredDate ? `(day ${draft.preferredDate}, time missing; duration ${draft.durationMinutes} min)` : `(missing; duration ${draft.durationMinutes} min)`}`,
    `Playmates: ${draft.participants.length ? draft.participants.map((p) => p.childName).join(', ') : draft.playmatesSkipped ? '(none, skipped)' : '(missing)'}`,
    `Activity: ${draft.activity ? draft.activity.title : '(missing)'}`,
    `Place: ${draft.location ? draft.location.name : '(missing)'}`,
    `Agenda: ${draft.agenda.length ? draft.agenda.join(' | ') : '(none yet)'}${draft.agendaConfirmed ? ' (reviewed by the parent)' : ''}`,
    `Place type: ${draft.location?.placeType || '(unknown)'}`,
    `Forecast: ${describeForecast(draft.weather)}`,
    `Safety notes on the card: ${(draft.safetyNotes || []).length ? draft.safetyNotes.join(' | ') : '(none)'}`,
    `Items to bring on the card: ${(draft.itemsToBring || []).length ? draft.itemsToBring.join(', ') : '(none)'}`,
    `Note: ${draft.note || '(none)'}`,
    `Warnings (say them in your own words, never the codes):${warningLines.length ? `\n${warningLines.join('\n')}` : ' (none)'}`,
    `Most severe: ${highest ? describeWarning(highest, draft) || highest.code : 'none'}`,
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
    // Every own child who comes (POST /playdates hostChildIds)
    hostChildren: draftHostChildren(draft),
    hostChildIds: draftHostChildren(draft).map((child) => child.childId),
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
    warnings: describedWarnings(draft),
    // Lengths the summary card can switch to
    durationChoices: durationChoicesFor(draft.durationMinutes, youngestOf(draft)),
  };
};
