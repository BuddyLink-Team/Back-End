import playdateService from '../../playdate/playdate.service.js';
import playdateSuggestionService from '../../playdate/playdate-suggestion.service.js';
import { PLAYDATE_ACTIVITIES } from '../../playdate/playdate.activities.js';
import { distanceKmBetween } from '../../discovery/matching.rules.js';
import { getScheduledStart, intervalsOverlap } from '../../../shared/helpers/date.helper.js';
import AppError from '../../../shared/exceptions/app-error.js';
import {
  AI_CARD_TYPES,
  AI_CHOICE_STATUS,
  AI_STEPS,
  AI_CONFIRM_STEP,
  AI_LIMITS,
  AI_DRAFT_WARNING_CODES,
  AI_OPTION_IDS,
} from '../ai-assistant.constants.js';
import { nextMissingStep, refreshDraft, toDraftResponse, summarizeDraft } from '../plan-draft.rules.js';
import { toPlaymateItem, toSuggestedPlaceItem, tagsOf } from './tool-sanitizer.js';

const MINUTE_MS = 60 * 1000;
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

// "2026-11-01", "09:00" -> "CN 01/11 · 09:00" (a calendar day, read without a time zone shift)
const formatSlotLabel = (date, time) => {
  const [year, month, day] = date.split('-').map(Number);
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${WEEKDAYS[weekDay]} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')} · ${time}`;
};

const formatDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} phút`;
  return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
};

const slotFitText = ({ matchedParents, totalParents }) => {
  if (!matchedParents) return 'Chưa ai đặt lịch ưu tiên';
  if (matchedParents === totalParents) {
    return totalParents > 1 ? 'Hợp lịch ưu tiên của các gia đình' : 'Hợp lịch ưu tiên của bạn';
  }
  return `Hợp với ${matchedParents}/${totalParents} gia đình`;
};

/**
 * Google Maps search for the place by its name and address, so Google opens that place. Its own coordinates
 * are only used when there is no address: an OpenStreetMap area (park) is located at the center of its
 * outline, which Google shows as another address.
 * @param {{ name?: string, address?: string, coordinates?: number[] }} place
 * @returns {string|null}
 */
export const googleMapsUrl = ({ name, address, coordinates } = {}) => {
  const query = address
    ? [name, address].filter(Boolean).join(', ')
    : Array.isArray(coordinates)
      ? `${coordinates[1]},${coordinates[0]}`
      : name;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
};

/**
 * Links shown under a place option: OpenStreetMap page and Google Maps
 * @param {{ name?: string, address?: string, osmUrl?: string, coordinates?: number[] }} place
 */
export const placeLinks = (place) =>
  [place.osmUrl && { kind: 'osm', href: place.osmUrl }, googleMapsUrl(place) && { kind: 'google_maps', href: googleMapsUrl(place) }].filter(
    Boolean
  );

/**
 * A card the parent answers by tapping its options
 * @param {Object} input
 * @returns {Object}
 */
export const makeChoiceCard = ({ stepId, title, options, selectionMode = 'single', allowCustom = false, allowSkip = false, ...extra }) => ({
  type: AI_CARD_TYPES.CHOICES,
  stepId,
  title,
  selectionMode,
  status: AI_CHOICE_STATUS.OPEN,
  selectedOptionIds: [],
  allowCustom,
  allowSkip,
  options,
  ...extra,
});

const requireHostChild = (draft) => {
  if (!draft?.hostChild) {
    throw new AppError('Pick the child of the playdate first', 400, 'PLAN_CHILD_REQUIRED');
  }
  return draft.hostChild.childId;
};

const participantIdsOf = (draft) => draft.participants.map((participant) => participant.childId).join(',');

/**
 * Activity of the catalog with this title or key, so the place step knows where it usually happens
 * @param {string} title
 * @returns {{ key: string|null, title: string, placeTypes: string[] }}
 */
export const resolveActivity = (title) => {
  const text = String(title || '').trim();
  const lower = text.toLowerCase();
  const known = PLAYDATE_ACTIVITIES.find(
    (activity) => activity.title.toLowerCase() === lower || activity.key.toLowerCase() === lower
  );
  return known ? { key: known.key, title: known.title, placeTypes: known.placeTypes } : { key: null, title: text, placeTypes: [] };
};

/* ---------------------------------------------------------------- step builders */

const buildChildStep = async (ctx) => {
  const children = await ctx.getChildren();
  const options = children.map((child) => ({
    id: `child:${child.childId}`,
    label: child.displayName,
    description: child.age !== null ? `${child.age} tuổi` : '',
    data: { childId: child.childId, displayName: child.displayName, age: child.age },
    links: [],
  }));
  // Every own child is listed: a typed name could only be a typo
  return { card: makeChoiceCard({ stepId: AI_STEPS.CHILD, title: 'Hẹn chơi cho bé nào?', options }) };
};

const buildTimeStep = async (ctx) => {
  const { draft } = ctx;
  const childId = requireHostChild(draft);
  const day = draft.preferredDate;
  const { slots } = await playdateSuggestionService.getTimeSlotSuggestions(ctx.userId, {
    childId,
    participantChildIds: participantIdsOf(draft),
    from: day || undefined,
    to: day || undefined,
    durationMinutes: draft.durationMinutes,
  });
  const options = slots.slice(0, AI_LIMITS.MAX_OPTIONS).map((slot) => ({
    id: `slot:${slot.date}T${slot.time}`,
    label: formatSlotLabel(slot.date, slot.time),
    description: `${formatDuration(slot.durationMinutes)} · ${slotFitText(slot)}`,
    data: slot,
    links: [],
  }));
  return {
    card: makeChoiceCard({
      stepId: AI_STEPS.TIME,
      title: day ? `Chọn giờ cho ngày ${day.split('-').reverse().slice(0, 2).join('/')}` : 'Chọn thời gian',
      options,
      allowCustom: true,
      durationMinutes: draft.durationMinutes,
    }),
  };
};

const buildPlaymatesStep = async (ctx) => {
  const { draft } = ctx;
  const childId = requireHostChild(draft);
  const [{ matched, others }, children] = await Promise.all([
    playdateService.getInvitableFriends(ctx.userId, { childId }),
    ctx.getChildren(),
  ]);
  const ownTags = tagsOf(children.find((child) => child.childId === childId));
  let candidates = [...matched, ...others].map((entry) => toPlaymateItem(entry, ownTags));

  // Only children free at the chosen time (their other playdates)
  if (draft.date && draft.time && candidates.length) {
    const start = getScheduledStart(new Date(draft.date), draft.time);
    const end = new Date(start.getTime() + draft.durationMinutes * MINUTE_MS);
    const busy = await playdateService.getBusyIntervals(candidates.map((child) => child.childId), start, end);
    const busyIds = new Set(
      busy.filter((interval) => intervalsOverlap(start, end, interval.start, interval.end)).map((interval) => interval.childId)
    );
    candidates = candidates.filter((child) => !busyIds.has(child.childId));
  }

  const options = candidates.slice(0, AI_LIMITS.MAX_PLAYMATE_OPTIONS).map((child) => ({
    id: `playmate:${child.childId}`,
    label: child.displayName,
    description: [child.age !== null ? `${child.age} tuổi` : null, `bé nhà ${child.parent.fullName}`].filter(Boolean).join(' · '),
    badge: child.source === 'paired' ? 'Bạn chơi của bé' : null,
    data: child,
    links: [{ kind: 'child_profile', childId: child.childId }],
  }));
  return {
    card: makeChoiceCard({
      stepId: AI_STEPS.PLAYMATES,
      title: 'Mời bạn nào cùng chơi?',
      options,
      selectionMode: 'multiple',
      allowCustom: true,
      allowSkip: true,
      // The card searches all the friends' children of this child (GET /playdates/friends?childId=)
      hostChildId: childId,
    }),
  };
};

const buildActivityStep = async (ctx) => {
  const { draft } = ctx;
  const childId = requireHostChild(draft);
  const { activities } = await playdateSuggestionService.getActivitySuggestions(ctx.userId, {
    childId,
    participantChildIds: participantIdsOf(draft),
  });
  const options = activities.slice(0, AI_LIMITS.MAX_OPTIONS).map((activity) => ({
    id: `activity:${activity.key}`,
    label: activity.title,
    description: activity.reason || '',
    data: { key: activity.key, title: activity.title, placeTypes: activity.placeTypes, durationMinutes: activity.durationMinutes },
    links: [],
  }));
  return { card: makeChoiceCard({ stepId: AI_STEPS.ACTIVITY, title: 'Các bé sẽ chơi gì?', options, allowCustom: true }) };
};

const buildPlaceStep = async (ctx, { type } = {}) => {
  const { draft } = ctx;
  const childId = requireHostChild(draft);
  const query = { childId, participantChildIds: participantIdsOf(draft), limit: AI_LIMITS.MAX_PLACES };
  const types = type ? [type] : (draft.activity?.placeTypes || []).slice(0, AI_LIMITS.MAX_PLACE_TYPES);

  const lists = await Promise.all(
    (types.length ? types : [undefined]).map((placeType) =>
      playdateSuggestionService.getPlaceSuggestions(ctx.userId, { ...query, type: placeType }).then((res) => res.places)
    )
  );
  const nearest = (place) => Math.min(...place.familyDistances.map((family) => family.distanceKm), Infinity);
  const byId = new Map();
  lists.flat().forEach((place) => byId.set(place.id, place));
  const places = [...byId.values()]
    .sort((a, b) => Number(b.isPreferredType) - Number(a.isPreferredType) || nearest(a) - nearest(b))
    .slice(0, AI_LIMITS.MAX_PLACES)
    .map(toSuggestedPlaceItem);
  places.forEach((place) => ctx.turn.places.set(place.id, place));

  const options = places.map((place) => ({
    id: `place:${place.id}`,
    label: place.name,
    description: [
      place.address,
      place.familyDistances.map((family) => `${family.label} ${String(family.distanceKm).replace('.', ',')} km`).join(' · '),
    ]
      .filter(Boolean)
      .join(' — '),
    data: place,
    links: placeLinks(place),
  }));
  return { card: makeChoiceCard({ stepId: AI_STEPS.PLACE, title: 'Chọn địa điểm', options, allowCustom: true }) };
};

// The main activities written by the model, for the parent to edit before the summary
const buildAgendaStep = async (ctx) => ({
  card: makeChoiceCard({
    stepId: AI_STEPS.AGENDA,
    title: 'Hoạt động chính của buổi hẹn',
    options: ctx.draft.agenda.map((item, index) => ({ id: `agenda:${index}`, label: item, description: '', data: {}, links: [] })),
    allowCustom: true,
  }),
});

const buildExtraStep = async () => ({
  card: makeChoiceCard({
    stepId: AI_STEPS.EXTRA,
    title: 'Bạn có muốn yêu cầu thêm gì không?',
    options: [
      {
        id: AI_OPTION_IDS.EXTRA_NONE,
        label: 'Không, xem lịch hẹn',
        description: 'Mình sẽ tổng hợp bảng chi tiết để bạn xác nhận',
        data: {},
        links: [],
      },
    ],
    allowCustom: true,
  }),
});

const STEP_BUILDERS = Object.freeze({
  [AI_STEPS.CHILD]: buildChildStep,
  [AI_STEPS.TIME]: buildTimeStep,
  [AI_STEPS.PLAYMATES]: buildPlaymatesStep,
  [AI_STEPS.ACTIVITY]: buildActivityStep,
  [AI_STEPS.PLACE]: buildPlaceStep,
  [AI_STEPS.AGENDA]: buildAgendaStep,
  [AI_STEPS.EXTRA]: buildExtraStep,
});

/**
 * Options of one planning step as a choice card (added to the turn)
 * @param {string} step - AI_STEPS value
 * @param {Object} ctx - Tool context
 * @param {Object} [options] - Step-specific (e.g. { type } for places)
 * @returns {Promise<Object>} Short result for the model
 */
export const showStep = async (step, ctx, options = {}) => {
  const { card } = await STEP_BUILDERS[step](ctx, options);
  ctx.turn.cards.push(card);
  return {
    step,
    optionsShown: card.options.map((option) => option.label),
    ...(card.options.length ? {} : { note: 'No suggestion available for this step: tell the parent and offer to type it.' }),
  };
};

/**
 * Warnings that need the database: a child already busy at the chosen time
 * @private
 */
const addScheduleConflicts = async (draft) => {
  const others = (draft.warnings || []).filter((warning) => warning.code !== AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT);
  if (!draft.date || !draft.time) {
    draft.warnings = others;
    return;
  }
  const start = getScheduledStart(new Date(draft.date), draft.time);
  const end = new Date(start.getTime() + draft.durationMinutes * MINUTE_MS);
  const childIds = [draft.hostChild?.childId, ...draft.participants.map((participant) => participant.childId)];
  const busy = await playdateService.getBusyIntervals(childIds, start, end);
  const conflicts = [
    ...new Set(busy.filter((interval) => intervalsOverlap(start, end, interval.start, interval.end)).map((i) => i.childId)),
  ].map((childId) => ({ code: AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT, childId }));
  draft.warnings = [...others, ...conflicts];
};

/**
 * FAR_PLACE warning when the place is far from the parent's home
 * @private
 */
const addPlaceDistance = (draft, parent) => {
  const others = (draft.warnings || []).filter((warning) => warning.code !== AI_DRAFT_WARNING_CODES.FAR_PLACE);
  const home = parent.location?.coordinates?.coordinates;
  const place = draft.location?.coordinates;
  const km = Array.isArray(home) && Array.isArray(place) ? distanceKmBetween(home, place) : null;
  // A place typed or picked outside the place step has no distances: at least the one from home
  if (draft.location && !draft.location.familyDistances?.length && Number.isFinite(km)) {
    draft.location.familyDistances = [{ label: 'Nhà bạn', distanceKm: Math.round(km * 10) / 10 }];
  }
  draft.warnings =
    Number.isFinite(km) && km > AI_LIMITS.FAR_PLACE_KM
      ? [...others, { code: AI_DRAFT_WARNING_CODES.FAR_PLACE, distanceKm: Math.round(km) }]
      : others;
};

/**
 * After the draft changed: show the next missing step, or the summary to confirm when nothing is missing
 * @param {Object} ctx
 * @returns {Promise<Object>} Result for the model
 */
export const advancePlan = async (ctx) => {
  const { draft } = ctx;
  const children = await ctx.getChildren();
  if (!draft.hostChild && children.length === 1) {
    draft.hostChild = { childId: children[0].childId, displayName: children[0].displayName };
  }

  refreshDraft(draft);
  // Warned as soon as the time or the place is known, so the model can tell the parent at that step
  await addScheduleConflicts(draft);
  addPlaceDistance(draft, ctx.parent);
  const step = nextMissingStep(draft);
  if (step === AI_CONFIRM_STEP) {
    ctx.turn.cards.push({
      type: AI_CARD_TYPES.PLAYDATE_DRAFT,
      stepId: AI_CONFIRM_STEP,
      status: AI_CHOICE_STATUS.OPEN,
      draft: toDraftResponse(draft),
    });
    return {
      status: draft.status,
      draft: summarizeDraft(draft),
      next: 'The detailed summary is shown with its confirm button: ask the parent to check it and confirm.',
    };
  }
  if (step === AI_STEPS.AGENDA && !draft.agenda.length) {
    return {
      status: draft.status,
      draft: summarizeDraft(draft),
      nextStep: step,
      next:
        'Call proposePlaydate now with an agenda of 3-5 concrete games or activities for these children at this place ' +
        '(what they play, e.g. "Thi xếp Lego theo chủ đề"), no warm-up, getting to know each other or goodbye items. ' +
        'The parent then reviews and edits it on the card.',
    };
  }

  const shown = await showStep(step, ctx);
  return { status: draft.status, draft: summarizeDraft(draft), nextStep: step, ...shown };
};
