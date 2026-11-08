import playdateService from '../../playdate/playdate.service.js';
import placesService from '../../places/places.service.js';
import placeAttractionsService from '../../places/place-attractions.service.js';
import { shouldSearchAttractions } from '../../playdate/playdate-suggestion.rules.js';
import subscriptionService from '../../subscription/subscription.service.js';
import { QUOTA_FEATURES } from '../../subscription/subscription.constants.js';
import AppError from '../../../shared/exceptions/app-error.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES, AI_LIMITS, AI_DRAFT_WARNING_CODES } from '../ai-assistant.constants.js';
import {
  emptyDraft,
  clampDuration,
  normalizeAgenda,
  isValidDate,
  isValidTime,
  isKnownAgendaItem,
  draftHostChildren,
  draftAgendaSize,
  withAttractionSource,
} from '../plan-draft.rules.js';
import { PLAYDATE_RULES } from '../../playdate/playdate.constants.js';
import { advancePlan, resolveActivity } from './plan-steps.js';
import { toPlaceItem, toPlaymateItem } from './tool-sanitizer.js';
import { PLAYDATE_ACTIVITIES, GENERIC_GAMES, pickAttractions } from '../../playdate/playdate.activities.js';

// Accent and case insensitive, so "bin" matches "Bin" and "an" matches "Ân"
export const normalizeName = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .trim()
    .toLowerCase();

/**
 * Start a new plan, unless the parent can no longer create a playdate this month
 * @returns {Promise<boolean>} false when blocked by the playdate creation quota (a notice card is added)
 */
export const startPlan = async (ctx) => {
  try {
    await subscriptionService.checkAndConsumeQuota(ctx.parentId, 'playdateCreate', false);
  } catch (error) {
    if (error.code !== 'QUOTA_EXCEEDED') throw error;
    ctx.turn.cards.push({
      type: AI_CARD_TYPES.QUOTA_NOTICE,
      feature: QUOTA_FEATURES.PLAYDATES_CREATED,
      limit: error.details?.limit ?? null,
      resetAt: error.details?.resetAt ?? null,
    });
    return false;
  }
  ctx.draft = emptyDraft();
  return true;
};

const toHostChild = (child) => ({
  childId: child.childId,
  displayName: child.displayName,
  age: child.age ?? null,
  interests: child.interests || [],
});

/**
 * Own children of the plan (at least one, main child first: playmates are ranked for it)
 * @param {Object} ctx
 * @param {string[]} childIds
 */
const setHostChildren = async (ctx, childIds) => {
  const children = await ctx.getChildren();
  const picked = [...new Set(childIds.map(String))].map((id) => children.find((child) => child.childId === id));
  if (!picked.length || picked.some((child) => !child)) throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
  if (picked.length > PLAYDATE_RULES.MAX_HOST_CHILDREN) {
    throw new AppError('Too many children for one playdate', 400, 'TOO_MANY_HOST_CHILDREN');
  }
  if (ctx.draft.hostChild?.childId !== picked[0].childId) {
    // Playmates and suggestions depend on the main child
    ctx.draft.participants = [];
    ctx.draft.playmatesSkipped = false;
  }
  ctx.draft.hostChildren = picked.map(toHostChild);
  ctx.draft.hostChild = ctx.draft.hostChildren[0];
};

/**
 * Invitees by child id or by name, among the children of accepted friends only
 * @returns {Promise<string[]>} Names that matched several children (left for the playmates step)
 */
const setParticipants = async (ctx, { childIds = [], names = [] }) => {
  const { draft } = ctx;
  const { matched, others } = await playdateService.getInvitableFriends(ctx.userId, { childId: draft.hostChild.childId });
  const friends = [...matched, ...others].map((entry) => toPlaymateItem(entry));
  const byId = new Map(friends.map((friend) => [friend.childId, friend]));

  const picked = new Map();
  const notFriends = [];
  childIds.forEach((id) => {
    const friend = byId.get(String(id));
    if (friend) picked.set(friend.childId, friend);
    else notFriends.push(String(id));
  });

  const ambiguous = [];
  names.forEach((name) => {
    const found = friends.filter((friend) => normalizeName(friend.displayName) === normalizeName(name));
    if (found.length === 1) picked.set(found[0].childId, found[0]);
    else if (found.length > 1) ambiguous.push(name);
    else notFriends.push(name);
  });

  if (picked.size) {
    draft.participants = [...picked.values()].map((friend) => ({
      parentId: friend.parent.parentId,
      childId: friend.childId,
      childName: friend.displayName,
      parentName: friend.parent.fullName,
      age: friend.age ?? null,
      interests: friend.interests || [],
      warnings: friend.warnings,
    }));
    draft.playmatesSkipped = false;
  }
  draft.warnings = [
    ...(draft.warnings || []).filter((warning) => warning.code !== AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND),
    // Only a warning: that child is simply not invited
    ...notFriends.map((value) => ({ code: AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND, value, severity: 'warn' })),
  ];
  return ambiguous;
};

/**
 * A place shown in this turn, or any cached place by its cache id or OpenStreetMap id
 */
const resolvePlace = async (ctx, placeId) => {
  const shown = ctx.turn.places.get(String(placeId));
  if (shown) return shown;
  return toPlaceItem(await placesService.getPlaceById(ctx.userId, placeId));
};

/**
 * The cached details of a place picked or typed by the parent (type, opening hours, map link), looked up by
 * its cache id or its OpenStreetMap id: the client only sends name, address and ids. null when unknown.
 * @returns {Promise<Object|null>}
 */
const findKnownPlace = async (ctx, place) => {
  for (const id of [place.id, place.placeId].filter(Boolean).map(String)) {
    try {
      return await resolvePlace(ctx, id);
    } catch (error) {
      if (!(error instanceof AppError) || !error.isOperational) throw error;
    }
  }
  return null;
};

/**
 * Put the place in the plan with every detail the cache has, then its real attractions when the place
 * surely has some (kids cafe, play sports center: Google Search, cached 30 days)
 * @param {Object} ctx
 * @param {Object} place - A suggested place, or the name / address / ids of a place the parent picked
 */
export const applyPlace = async (ctx, place) => {
  const known = await findKnownPlace(ctx, place);
  // The parent's wording of the name and address wins; the cache gives what the client cannot know
  setLocation(ctx.draft, known ? { ...known, ...pickDefined(place, ['name', 'address']), familyDistances: place.familyDistances } : place);
  const placeId = ctx.draft.location.id || ctx.draft.location.placeId;
  if (shouldSearchAttractions(ctx.draft.location) !== 'yes' || !placeId) return;
  try {
    const attractions = await placeAttractionsService.getOrFetchAttractions(placeId, ctx.draft.location);
    if (attractions?.length) ctx.draft.location.attractions = attractions;
  } catch (_error) {
    // Attractions are optional, the plan goes on without them
  }
};

const pickDefined = (source, keys) =>
  Object.fromEntries(keys.filter((key) => String(source?.[key] || '').trim()).map((key) => [key, source[key]]));

// [lng, lat] from an array or a GeoJSON point (the place search sends { type: 'Point', coordinates })
const toLngLat = (value) => {
  const pair = Array.isArray(value) ? value : value?.coordinates;
  return Array.isArray(pair) && pair.length === 2 && pair.every((n) => Number.isFinite(Number(n))) ? pair.map(Number) : null;
};

export const setLocation = (draft, place) => {
  draft.location = {
    id: place.id || place.placeId || null,
    name: String(place.name || '').trim().slice(0, 200),
    address: String(place.address || '').trim().slice(0, 300),
    placeId: place.placeId || place.id || null,
    coordinates: toLngLat(place.coordinates),
    // Shown on the summary as on the place step (not part of the POST /playdates body)
    placeType: place.placeType || place.type || null,
    openingHours: String(place.openingHours || '').slice(0, 200),
    osmUrl: place.osmUrl || null,
    tags: place.tags || place.osmTags || {},
    osmTags: place.osmTags || place.tags || {},
    attractions: place.attractions || [],
    familyDistances: (place.familyDistances || [])
      .filter((family) => Number.isFinite(family.distanceKm))
      .map((family) => ({ label: String(family.label || ''), distanceKm: family.distanceKm })),
  };
};

/**
 * Merge fields into the draft (from the model's arguments or a tapped option)
 * @param {Object} ctx
 * @param {Object} fields
 * @returns {Promise<{ ambiguousNames: string[] }>}
 */
export const applyPlanFields = async (ctx, fields) => {
  const { draft } = ctx;
  const hostChildIds = Array.isArray(fields.hostChildIds) && fields.hostChildIds.length
    ? fields.hostChildIds
    : fields.hostChildId
      ? [fields.hostChildId]
      : [];
  if (hostChildIds.length) {
    await setHostChildren(ctx, hostChildIds);
  } else if (!draft.hostChild) {
    const children = await ctx.getChildren();
    if (children.length === 1) await setHostChildren(ctx, [children[0].childId]);
  }

  if (fields.durationMinutes) draft.durationMinutes = clampDuration(fields.durationMinutes);
  const previousDate = draft.date;
  if (isValidDate(fields.date) && isValidTime(fields.time)) {
    draft.date = fields.date;
    draft.time = fields.time;
    draft.preferredDate = null;
  } else if (isValidDate(fields.date)) {
    // A day without a time: the time step only offers that day
    draft.preferredDate = fields.date;
    draft.date = null;
    draft.time = null;
  } else if (isValidTime(fields.time) && (draft.preferredDate || draft.date)) {
    draft.date = draft.preferredDate || draft.date;
    draft.time = fields.time;
    draft.preferredDate = null;
  }
  if (draft.date && previousDate && draft.date !== previousDate) {
    draft.weather = null;
  }

  let ambiguousNames = [];
  const childIds = (fields.participantChildIds || []).map(String);
  const names = (fields.participantNames || []).map(String).filter(Boolean);
  if (childIds.length || names.length) {
    // Friends are ranked for the host child: keep them until the child is picked
    draft.pendingParticipants = { childIds, names };
  }
  if (draft.pendingParticipants && draft.hostChild) {
    ambiguousNames = await setParticipants(ctx, draft.pendingParticipants);
    draft.pendingParticipants = null;
  }
  if (fields.noPlaymates === true) {
    draft.participants = [];
    draft.playmatesSkipped = true;
  }

  if (fields.activity) {
    const activity = resolveActivity(String(fields.activity).slice(0, 200));
    // The main activities were written for the previous activity
    if (activity.title !== draft.activity?.title) {
      draft.agenda = [];
      draft.agendaConfirmed = false;
    }
    draft.activity = activity;
  }

  if (fields.placeId) {
    await applyPlace(ctx, await resolvePlace(ctx, fields.placeId));
  } else if (fields.locationName) {
    setLocation(draft, { name: fields.locationName, address: fields.locationAddress || '' });
  }

  if (fields.agenda) {
    let agenda = normalizeAgenda(fields.agenda);
    if (agenda.length) {
      // Catalog games, the place's real attractions and the chosen activity: the model only rewords them
      const references = [
        ...PLAYDATE_ACTIVITIES,
        ...GENERIC_GAMES,
        ...(draft.location?.attractions || []),
        ...(draft.activity ? [draft.activity] : []),
      ];

      const suited = pickAttractions({
        children: [
          ...draftHostChildren(draft).map((child) => ({ age: child.age, displayName: child.displayName, interests: child.interests })),
          ...draft.participants.map((p) => ({ age: p.age, displayName: p.childName, interests: p.interests })),
        ],
        durationMinutes: draft.durationMinutes,
        availableAttractions: draft.location?.attractions || [],
        placeType: draft.location?.placeType || null,
      });
      const fallbackList = suited.filter((title) => !agenda.includes(title));

      // An unknown item is replaced by the next suited game not already in the list, or dropped
      let fallbackIndex = 0;
      agenda = agenda
        .map((item) => {
          if (isKnownAgendaItem(item, references)) return item;
          const replacement = fallbackList[fallbackIndex] || null;
          fallbackIndex += 1;
          return replacement;
        })
        .filter(Boolean);
      agenda = agenda.length ? [...new Set(agenda)] : suited;
      // As many games as the playdate holds (A2), the real attractions written with their source (A4)
      agenda = agenda.slice(0, draftAgendaSize(draft).max).map((item) => withAttractionSource(item, draft.location));
    }
    draft.agenda = agenda;
  }
  if (typeof fields.note === 'string') draft.note = fields.note.trim().slice(0, AI_LIMITS.NOTE_MAX_LENGTH);
  // Precautions the model adds to the rule-based ones (it can never remove those, B1)
  if (Array.isArray(fields.safetyNotes)) {
    draft.extraSafetyNotes = [...new Set(fields.safetyNotes.map((item) => String(item || '').replace(/\s+/g, ' ').trim()).filter(Boolean))]
      .map((item) => item.slice(0, AI_LIMITS.SAFETY_NOTE_MAX_LENGTH))
      .slice(0, AI_LIMITS.MAX_EXTRA_SAFETY_NOTES);
  }

  return { ambiguousNames };
};

export const proposePlaydateTool = {
  declaration: {
    name: AI_TOOL_NAMES.PROPOSE_PLAYDATE,
    description:
      'Plan a playdate step by step. Put EVERY detail the parent already gave (child, day, time, friends, activity, place). ' +
      'It saves them in the plan draft (nothing is created), then shows the options of the next missing step, ' +
      'or the summary to confirm when nothing is missing. Call it with startNew=true to begin a new plan. ' +
      'When activity and place are known, also send an agenda of concrete games or activities (as many as the result asks for, short, no times).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        startNew: { type: 'boolean', description: 'Start a new plan (drops the current draft)' },
        hostChildId: { type: 'string', description: "Id of the parent's own child (from getMyChildren)" },
        hostChildIds: {
          type: 'array',
          items: { type: 'string' },
          description: "Several own children coming together (main child first); use instead of hostChildId",
        },
        date: { type: 'string', description: 'YYYY-MM-DD (alone: only that day is offered for the time step)' },
        time: { type: 'string', description: 'HH:mm, 24h' },
        durationMinutes: { type: 'integer', minimum: 30, maximum: 480 },
        participantNames: { type: 'array', items: { type: 'string' }, description: "Names of friends' children to invite" },
        participantChildIds: { type: 'array', items: { type: 'string' } },
        noPlaymates: { type: 'boolean', description: 'The parent does not want to invite anyone yet' },
        activity: { type: 'string' },
        placeId: { type: 'string', description: 'id of a place shown earlier' },
        locationName: { type: 'string' },
        locationAddress: { type: 'string' },
        agenda: {
          type: 'array',
          items: { type: 'string' },
          maxItems: AI_LIMITS.MAX_AGENDA_ITEMS,
          description:
            'Concrete games or activities of the playdate (what the children play or make; about 3-4 for one hour), a few words each, ' +
            'no times, no warm-up / getting to know each other / goodbye items',
        },
        note: { type: 'string', description: 'Extra request of the parent that is not a field (e.g. what to bring)' },
        safetyNotes: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
          description:
            'Extra safety precautions for these children and activities, added to the rule-based ones (which always stay)',
        },
      },
    },
  },

  async execute(args, ctx) {
    if (!ctx.draft || args.startNew) {
      const started = await startPlan(ctx);
      if (!started) {
        return {
          error: {
            code: 'PLAYDATE_QUOTA_EXCEEDED',
            message: 'The parent cannot create more playdates this month (Free plan). Tell them and suggest Premium in [[Gói hội viên & Hạn mức]]; do not plan.',
          },
        };
      }
    }

    const { ambiguousNames } = await applyPlanFields(ctx, args);
    const result = await advancePlan(ctx);
    return ambiguousNames.length
      ? { ...result, ambiguousNames, note: 'Several friends\' children have these names: let the parent pick in the playmates step.' }
      : result;
  },
};

export default proposePlaydateTool;
