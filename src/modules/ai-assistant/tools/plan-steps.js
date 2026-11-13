import playdateService from '../../playdate/playdate.service.js';
import playdateSuggestionService from '../../playdate/playdate-suggestion.service.js';
import { PLAYDATE_ACTIVITIES, pickAttractions, activityGamesFor } from '../../playdate/playdate.activities.js';
import { INDOOR_PLACE_TYPES } from '../../playdate/playdate.constants.js';
import { shouldSearchAttractions } from '../../playdate/playdate-suggestion.rules.js';
import openMeteoAdapter from '../../../integrations/weather/open-meteo.adapter.js';
import { distanceKmBetween } from '../../discovery/matching.rules.js';
import { getScheduledStart, getZonedParts, intervalsOverlap } from '../../../shared/helpers/date.helper.js';
import AppError from '../../../shared/exceptions/app-error.js';
import {
  AI_CARD_TYPES,
  AI_CHOICE_STATUS,
  AI_STEPS,
  AI_CONFIRM_STEP,
  AI_LIMITS,
  AI_DRAFT_WARNING_CODES,
  AI_OPTION_IDS,
  AI_WARNING_SEVERITY,
} from '../ai-assistant.constants.js';
import { isBadWeather } from '../safety-rules.js';
import {
  nextMissingStep,
  refreshDraft,
  toDraftResponse,
  summarizeDraft,
  isCurrentSlotFit,
  groupKeyOf,
  draftHostChildren,
  draftAgendaSize,
  endTimeOf,
  defaultDurationFor,
  durationChoicesFor,
  youngestOf,
  withAttractionSource,
} from '../plan-draft.rules.js';
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

// Fit with the days and time slots the families marked as free in their profile: the host and every
// invited family count
export const slotFitText = ({ matchedParents, totalParents }) => {
  if (!matchedParents) return 'Ngoài buổi rảnh trong hồ sơ';
  if (matchedParents === totalParents) {
    return totalParents > 1 ? 'Đúng buổi rảnh của các gia đình' : 'Đúng buổi bạn thường rảnh';
  }
  return `Hợp buổi rảnh của ${matchedParents}/${totalParents} gia đình`;
};

// Start times tried each day by the time step (more than the 3 of the Create Playdate form)
const AI_START_TIMES = Object.freeze([
  ['morning', '08:30'],
  ['morning', '09:30'],
  ['morning', '10:00'],
  ['afternoon', '14:30'],
  ['afternoon', '15:30'],
  ['afternoon', '16:30'],
  ['evening', '18:00'],
]);
const MAX_SLOTS_PER_DAY = 2;
const MAX_BUSY_LINES = 3;

const pad2 = (value) => String(value).padStart(2, '0');
// "09:30" in the business time zone
const clockOf = (date) => {
  const parts = getZonedParts(date);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
};
// "T7 08/11" in the business time zone
const dayLabelOf = (date) => {
  const parts = getZonedParts(date);
  const weekDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return `${WEEKDAYS[weekDay]} ${pad2(parts.day)}/${pad2(parts.month)}`;
};

// Names of every child of the plan by id (own children and invited ones)
const childNamesOf = (draft) =>
  new Map([
    ...draftHostChildren(draft).map((child) => [child.childId, child.displayName]),
    ...draft.participants.map((participant) => [participant.childId, participant.childName]),
  ]);

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

// Other children of the group for the suggestions: the host's other own children, then the invited ones
const participantIdsOf = (draft) =>
  [...draftHostChildren(draft).slice(1), ...draft.participants].map((child) => child.childId).join(',');

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
  // Every own child is listed: a typed name could only be a typo. Several of them can come together
  // (at least one; the first picked is the main child the playmates are ranked for)
  return {
    card: makeChoiceCard({
      stepId: AI_STEPS.CHILD,
      title: 'Hẹn chơi cho bé nào?',
      options,
      selectionMode: options.length > 1 ? 'multiple' : 'single',
    }),
  };
};

/**
 * Length of the playdate before the time step: the parent's choice, otherwise a default for the youngest
 * child (toddlers tire quickly), so the slots are checked for the real length
 * @param {Object} draft
 */
export const ensureDuration = (draft) => {
  if (draft.durationSource === 'parent') return;
  draft.durationMinutes = defaultDurationFor(youngestOf(draft));
  draft.durationSource = 'default';
};

/**
 * Other playdates of the children in the range, as short lines ("Bé An bận T7 08/11 09:00–11:00")
 * @private
 */
const busyLinesOf = (busy, draft, range) => {
  const names = childNamesOf(draft);
  const seen = new Set();
  return (busy || [])
    .filter((interval) => !range || (interval.end > range.from && interval.start < new Date(range.to.getTime() + 24 * 60 * MINUTE_MS)))
    .filter((interval) => {
      const key = `${interval.childId}:${interval.start.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start)
    .map((interval) => `Bé ${names.get(String(interval.childId)) || 'trong nhóm'} bận ${dayLabelOf(interval.start)} ${clockOf(interval.start)}–${clockOf(interval.end)}`);
};

const buildTimeStep = async (ctx, { conflict } = {}) => {
  const { draft } = ctx;
  const childId = requireHostChild(draft);
  ensureDuration(draft);
  const day = draft.preferredDate;
  const { slots, busy, range } = await playdateSuggestionService.getTimeSlotSuggestions(ctx.userId, {
    childId,
    participantChildIds: participantIdsOf(draft),
    from: day || undefined,
    to: day || undefined,
    durationMinutes: draft.durationMinutes,
    placeOpeningHours: draft.location?.openingHours || undefined,
    placeCoordinates: draft.location?.coordinates || undefined,
    placeId: draft.location?.id || draft.location?.placeId || undefined,
    startTimes: AI_START_TIMES,
    maxPerDay: day ? AI_START_TIMES.length : MAX_SLOTS_PER_DAY,
    limit: AI_LIMITS.MAX_OPTIONS + 1,
    withBusy: true,
  });
  const options = slots.slice(0, AI_LIMITS.MAX_OPTIONS + 1).map((slot) => ({
    id: `slot:${slot.date}T${slot.time}`,
    label: `${formatSlotLabel(slot.date, slot.time)}–${endTimeOf(slot.time, slot.durationMinutes)}`,
    description: `Các bé đều rảnh · ${slotFitText(slot)}`,
    data: slot,
    links: [],
  }));

  const childCount = childNamesOf(draft).size;
  const busyLines = busyLinesOf(busy, draft, range);
  const youngest = youngestOf(draft);
  const durationText =
    draft.durationSource === 'parent'
      ? `Thời lượng ${formatDuration(draft.durationMinutes)}.`
      : `Thời lượng gợi ý ${formatDuration(draft.durationMinutes)}${youngest !== null ? ` cho bé ${youngest} tuổi` : ''}, bạn đổi được ngay bên dưới.`;
  const busyText = busyLines.length
    ? `Đã kiểm tra lịch hẹn của ${childCount} bé và ẩn các giờ trùng: ${busyLines.slice(0, MAX_BUSY_LINES).join('; ')}${busyLines.length > MAX_BUSY_LINES ? '…' : ''}.`
    : `Đã kiểm tra lịch hẹn của ${childCount} bé: các giờ dưới đây không trùng lịch nào.`;
  return {
    card: makeChoiceCard({
      stepId: AI_STEPS.TIME,
      title: day ? `Chọn giờ cho ngày ${day.split('-').reverse().slice(0, 2).join('/')}` : 'Chọn thời gian',
      description: [conflict, durationText, busyText, '"Buổi rảnh" là ngày và buổi các gia đình chọn trong hồ sơ.']
        .filter(Boolean)
        .join(' '),
      options,
      allowCustom: true,
      durationMinutes: draft.durationMinutes,
      durationChoices: durationChoicesFor(draft.durationMinutes, youngest),
    }),
    busyLines,
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
  const query = {
    childId,
    participantChildIds: participantIdsOf(draft),
    limit: AI_LIMITS.MAX_PLACES,
    date: draft.date || undefined,
    time: draft.time || undefined,
    durationMinutes: draft.durationMinutes,
  };
  const types = type ? [type] : (draft.activity?.placeTypes || []).slice(0, AI_LIMITS.MAX_PLACE_TYPES);

  // One search per place type; a missing location is reported on the card, other errors leave that type out
  let locationMissing = false;
  let areaSyncing = false;
  const search = async (placeTypes, extra = {}) => {
    const lists = await Promise.all(
      (placeTypes.length ? placeTypes : [undefined]).map((placeType) =>
        playdateSuggestionService
          .getPlaceSuggestions(ctx.userId, { ...query, type: placeType, ...extra })
          .then((res) => {
            areaSyncing = areaSyncing || Boolean(res.areaSyncing);
            return res.places;
          })
          .catch((error) => {
            if (['LOCATION_REQUIRED', 'PARENT_LOCATION_REQUIRED'].includes(error.code)) {
              locationMissing = true;
              return [];
            }
            if (error instanceof AppError && error.isOperational) return [];
            throw error;
          })
      )
    );
    return lists.flat();
  };

  const byId = new Map();
  const add = (list) => list.forEach((place) => byId.has(place.id) || byId.set(place.id, place));
  add(await search(types));
  // Few places of the activity's types: any kid-friendly place nearby, then further away
  const preferredCount = byId.size;
  if (!locationMissing && byId.size < MIN_PLACE_OPTIONS && types.length) add(await search([]));
  if (!locationMissing && byId.size < MIN_PLACE_OPTIONS) add(await search([], { minRadiusMeters: WIDE_PLACE_RADIUS_METERS }));
  const widened = byId.size > preferredCount;

  const nearest = (place) => Math.min(...place.familyDistances.map((family) => family.distanceKm), Infinity);
  // Rain that day (D2): indoor places first. Places closed at the chosen time stay last (C)
  const isRainy = isBadWeather(draft.weather);
  const indoorFirst = (place) => (isRainy && INDOOR_PLACE_TYPES.includes(place.type) ? 1 : 0);
  const places = [...byId.values()]
    .sort(
      (a, b) =>
        (a.timePenalty || 0) - (b.timePenalty || 0) ||
        indoorFirst(b) - indoorFirst(a) ||
        Number(b.isPreferredType) - Number(a.isPreferredType) ||
        nearest(a) - nearest(b)
    )
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
  // Always a place to pick: at home, the families agree on the address in the group chat
  options.push(homePlaceOption(ctx));

  const typeText = types.map((placeType) => PLACE_TYPE_TEXT[placeType] || placeType).join(', ');
  const description = [
    locationMissing ? 'Bạn cập nhật vị trí trong Hồ sơ cá nhân để mình gợi ý địa điểm gần nhà nhé.' : null,
    !locationMissing && places.length === 0
      ? areaSyncing
        ? 'Dữ liệu địa điểm quanh khu vực của bạn đang được cập nhật, vài phút nữa sẽ có thêm gợi ý.'
        : 'Gần các gia đình chưa có địa điểm nào trong dữ liệu của mình.'
      : null,
    !locationMissing && places.length > 0 && widened && typeText
      ? `Gần các gia đình chưa có nhiều ${typeText}, mình gợi ý thêm các địa điểm khác phù hợp với bé.`
      : null,
    isRainy ? 'Dự báo ngày này có mưa: các địa điểm trong nhà được xếp trước.' : null,
    'Bạn cũng có thể chọn chơi tại nhà hoặc tìm địa điểm khác.',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    card: makeChoiceCard({ stepId: AI_STEPS.PLACE, title: 'Chọn địa điểm', options, allowCustom: true, description }),
  };
};

const PLACE_TYPE_TEXT = Object.freeze({
  park: 'công viên',
  kids_cafe: 'khu vui chơi trong nhà',
  playground: 'sân chơi',
  library: 'thư viện',
  sports_center: 'trung tâm thể thao',
  workshop: 'xưởng sáng tạo',
});
const MIN_PLACE_OPTIONS = 3;
const WIDE_PLACE_RADIUS_METERS = 30000;
export const HOME_PLACE_TYPE = 'home';

/**
 * "At home": the families agree on the address in the group chat (no home address is ever shared here)
 * @param {Object} ctx
 * @returns {Object}
 */
const homePlaceOption = (ctx) => {
  const area = [ctx.parent?.location?.area, ctx.parent?.location?.city].filter(Boolean).join(', ');
  return {
    id: 'place:home',
    label: 'Chơi tại nhà',
    description: 'Nhà bạn hoặc nhà một bạn chơi, địa chỉ cụ thể các gia đình nhắn riêng trong nhóm chat',
    data: {
      id: null,
      name: 'Chơi tại nhà',
      address: area ? `Khu vực ${area} (địa chỉ nhắn riêng trong nhóm chat)` : 'Địa chỉ nhắn riêng trong nhóm chat',
      placeType: HOME_PLACE_TYPE,
      familyDistances: [],
    },
    links: [],
  };
};

// The main activities written by the model, for the parent to edit before the summary
const buildAgendaStep = async (ctx) => {
  const searchStatus = ctx.draft.location ? shouldSearchAttractions(ctx.draft.location) : 'no';
  const card = makeChoiceCard({
    stepId: AI_STEPS.AGENDA,
    title: 'Hoạt động chính của buổi hẹn',
    description: ctx.draft.activity?.title
      ? `Các trò chơi cho "${ctx.draft.activity.title}" trong ${formatDuration(ctx.draft.durationMinutes)}. Bạn sửa, thêm, bớt hoặc xin gợi ý khác nhé.`
      : '',
    options: ctx.draft.agenda.map((item, index) => ({ id: `agenda:${index}`, label: item, description: '', data: {}, links: [] })),
    allowCustom: true,
  });
  card.canSearchAttractions = searchStatus === 'uncertain';
  // "Other games": another set of games of this activity (choice-handler.js)
  card.canRegenerate = true;
  return { card };
};

/**
 * Games of the plan picked by rules: the chosen activity's games first, a few real attractions of the
 * place, suited to every child's age and interests
 * @param {Object} draft
 * @param {{ exclude?: string[], variant?: number }} [options]
 * @returns {string[]}
 */
export const suggestAgenda = (draft, { exclude = [], variant = 0 } = {}) =>
  pickAttractions({
    children: [
      ...draftHostChildren(draft).map((child) => ({ age: child.age, interests: child.interests })),
      ...draft.participants.map((participant) => ({ age: participant.age, interests: participant.interests })),
    ],
    durationMinutes: draft.durationMinutes,
    availableAttractions: draft.location?.attractions || [],
    placeType: draft.location?.placeType || null,
    activity: draft.activity,
    exclude,
    variant,
  }).map((title) => withAttractionSource(title, draft.location));

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
  const { card, busyLines } = await STEP_BUILDERS[step](ctx, options);
  ctx.turn.cards.push(card);
  return {
    step,
    optionsShown: card.options.map((option) => option.label),
    ...(card.description ? { cardNote: card.description } : {}),
    ...(busyLines?.length ? { busyChildren: busyLines } : {}),
    ...(step === AI_STEPS.TIME ? { durationMinutes: ctx.draft.durationMinutes } : {}),
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
  const childIds = [...draftHostChildren(draft), ...draft.participants].map((child) => child.childId);
  const ownIds = new Set(draftHostChildren(draft).map((child) => child.childId));
  const busy = await playdateService.getBusyIntervals(childIds, start, end);
  const names = childNamesOf(draft);
  const seen = new Set();
  const conflicts = busy
    .filter((interval) => intervalsOverlap(start, end, interval.start, interval.end))
    .filter((interval) => {
      const id = String(interval.childId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((interval) => ({
      code: AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT,
      childId: String(interval.childId),
      childName: names.get(String(interval.childId)) || '',
      // When the other playdate is (shown on the summary and told by the model)
      start: clockOf(interval.start),
      end: clockOf(interval.end),
      // An own child cannot be in two playdates (POST /playdates refuses it); an invited child only warns,
      // their parent cannot accept until it is free
      severity: ownIds.has(String(interval.childId)) ? AI_WARNING_SEVERITY.BLOCK : AI_WARNING_SEVERITY.WARN,
    }));
  draft.warnings = [...others, ...conflicts];
};

/**
 * Whether an own child of the plan is already in another playdate at the chosen time
 * @param {Object} draft
 * @returns {Object|null} The conflict warning
 */
export const ownScheduleConflict = (draft) =>
  (draft.warnings || []).find(
    (warning) => warning.code === AI_DRAFT_WARNING_CODES.SCHEDULE_CONFLICT && warning.severity === AI_WARNING_SEVERITY.BLOCK
  ) || null;

/**
 * Fit of the chosen time with the preferred days and time slots of the host and invited families,
 * kept on the draft for the NOT_PREFERRED_TIME warning (recomputed when the time or the invitees change)
 * @private
 */
const addSlotFit = async (ctx) => {
  const { draft } = ctx;
  if (!draft.hostChild || !draft.date || !draft.time) {
    draft.slotFit = null;
    return;
  }
  if (isCurrentSlotFit(draft, draft.slotFit)) return;
  try {
    const fit = await playdateSuggestionService.getSlotFit(ctx.userId, {
      childId: draft.hostChild.childId,
      participantChildIds: participantIdsOf(draft),
      date: draft.date,
      time: draft.time,
    });
    draft.slotFit = { ...fit, date: draft.date, time: draft.time, groupKey: groupKeyOf(draft) };
  } catch (_error) {
    // The fit is only an information: a failed lookup leaves the warning out
    draft.slotFit = null;
  }
};

/**
 * Forecast of the playdate day (Open-Meteo, BUD-49 D2): at the place once it is chosen, before that around
 * the parent's home, so the place step can put indoor places first on a rainy day.
 * Fetched again when the day or the point changes; a failed lookup or a day past the forecast leaves the weather out.
 * @private
 */
const addWeather = async (ctx) => {
  const { draft } = ctx;
  const placePoint = Array.isArray(draft.location?.coordinates) && draft.location.coordinates.length === 2 ? draft.location.coordinates : null;
  const home = ctx.parent?.location?.coordinates?.coordinates;
  const point = placePoint || (Array.isArray(home) && home.length === 2 ? home : null);
  if (!draft.date || !point) return;
  const basis = placePoint ? 'place' : 'home';
  // The forecast belongs to one day, time slot and point: any of them changing asks for it again
  const key = [draft.date, draft.time || '', draft.durationMinutes, basis, ...point.map((value) => Math.round(value * 100) / 100)].join('|');
  if (draft.weather?.key === key) return;
  try {
    const [lng, lat] = point;
    const weather = await openMeteoAdapter.getDailyWeather(lat, lng, draft.date, {
      time: draft.time,
      durationMinutes: draft.durationMinutes,
    });
    // Unknown weather: never keep the forecast of another day or point
    draft.weather = weather ? { ...weather, date: draft.date, basis, key } : null;
  } catch (_error) {
    draft.weather = null;
  }
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
    draft.hostChild = {
      childId: children[0].childId,
      displayName: children[0].displayName,
      age: children[0].age ?? null,
      interests: children[0].interests || [],
    };
    draft.hostChildren = [draft.hostChild];
  }
  // Until the parent picks a length, it follows the youngest child of the plan
  ensureDuration(draft);

  await addWeather(ctx);
  await addSlotFit(ctx);
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
    // The games are picked by rules at once (the card is never missing); the model may tailor them
    draft.agenda = suggestAgenda(draft);
    const kids = [
      ...draftHostChildren(draft).map((child) => ({ name: child.displayName, age: child.age, interests: child.interests })),
      ...draft.participants.map((p) => ({ name: p.childName, age: p.age, interests: p.interests })),
    ].map((kid) => `${kid.name} (${kid.age != null ? `${kid.age} tuổi` : 'tuổi chưa rõ'}${kid.interests?.length ? `, thích ${kid.interests.join(', ')}` : ''})`);
    const size = draftAgendaSize(draft);
    const ideas = activityGamesFor(draft.activity).map((game) => game.title);
    const shown = await showStep(step, ctx);
    return {
      status: draft.status,
      draft: summarizeDraft(draft),
      nextStep: step,
      ...shown,
      next:
        `The agenda card is shown with these games for "${draft.activity?.title || 'the playdate'}": ${draft.agenda.join(' | ')}. ` +
        `Children: ${kids.join('; ')}. ` +
        (ideas.length ? `Other games of this activity: ${ideas.join(', ')}. ` : '') +
        (draft.location?.attractions?.length
          ? `Real attractions of ${draft.location.name}: ${draft.location.attractions.map((a) => a.title).join(', ')}. `
          : '') +
        `Only if you can clearly fit them better to these children (their interests, ages, the place), call proposePlaydate ` +
        `once with an improved agenda of ${size.min}-${size.max} concrete games of this activity (a few words each, no times, ` +
        'no warm-up / getting to know each other / goodbye). Otherwise just ask the parent to review and edit the card.',
    };
  }

  const shown = await showStep(step, ctx);
  return { status: draft.status, draft: summarizeDraft(draft), nextStep: step, ...shown };
};
