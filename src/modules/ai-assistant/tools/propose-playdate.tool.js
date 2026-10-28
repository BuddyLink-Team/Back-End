import mongoose from 'mongoose';
import playdateService from '../../playdate/playdate.service.js';
import placesService from '../../places/places.service.js';
import subscriptionService from '../../subscription/subscription.service.js';
import { QUOTA_FEATURES } from '../../subscription/subscription.constants.js';
import AppError from '../../../shared/exceptions/AppError.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES, AI_LIMITS, AI_DRAFT_WARNING_CODES } from '../ai-assistant.constants.js';
import { emptyDraft, clampDuration, normalizeAgenda, isValidDate, isValidTime } from '../plan-draft.rules.js';
import { advancePlan, resolveActivity } from './plan-steps.js';
import { toPlaceItem, toPlaymateItem } from './tool-sanitizer.js';

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

const setHostChild = async (ctx, childId) => {
  const children = await ctx.getChildren();
  const child = children.find((item) => item.childId === String(childId));
  if (!child) throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
  if (ctx.draft.hostChild?.childId !== child.childId) {
    // Playmates and suggestions depend on the child
    ctx.draft.participants = [];
    ctx.draft.playmatesSkipped = false;
  }
  ctx.draft.hostChild = { childId: child.childId, displayName: child.displayName };
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
      warnings: friend.warnings,
    }));
    draft.playmatesSkipped = false;
  }
  draft.warnings = [
    ...(draft.warnings || []).filter((warning) => warning.code !== AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND),
    ...notFriends.map((value) => ({ code: AI_DRAFT_WARNING_CODES.INVITEE_NOT_FRIEND, value })),
  ];
  return ambiguous;
};

/**
 * A place shown in this turn, or any cached place by id
 */
const resolvePlace = async (ctx, placeId) => {
  const shown = ctx.turn.places.get(String(placeId));
  if (shown) return shown;
  if (!mongoose.isValidObjectId(placeId)) throw new AppError('Place not found', 404, 'PLACE_NOT_FOUND');
  return toPlaceItem(await placesService.getPlaceById(ctx.userId, placeId));
};

export const setLocation = (draft, place) => {
  draft.location = {
    id: place.id || null,
    name: String(place.name || '').trim().slice(0, 200),
    address: String(place.address || '').trim().slice(0, 300),
    placeId: place.placeId || null,
    coordinates: Array.isArray(place.coordinates) && place.coordinates.length === 2 ? place.coordinates.map(Number) : null,
    // Shown on the summary as on the place step (not part of the POST /playdates body)
    placeType: place.placeType || place.type || null,
    openingHours: String(place.openingHours || '').slice(0, 200),
    osmUrl: place.osmUrl || null,
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
  if (fields.hostChildId) {
    await setHostChild(ctx, fields.hostChildId);
  } else if (!draft.hostChild) {
    const children = await ctx.getChildren();
    if (children.length === 1) await setHostChild(ctx, children[0].childId);
  }

  if (fields.durationMinutes) draft.durationMinutes = clampDuration(fields.durationMinutes);
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
    setLocation(draft, await resolvePlace(ctx, fields.placeId));
  } else if (fields.locationName) {
    setLocation(draft, { name: fields.locationName, address: fields.locationAddress || '' });
  }

  if (fields.agenda) draft.agenda = normalizeAgenda(fields.agenda);
  if (typeof fields.note === 'string') draft.note = fields.note.trim().slice(0, AI_LIMITS.NOTE_MAX_LENGTH);

  return { ambiguousNames };
};

export const proposePlaydateTool = {
  declaration: {
    name: AI_TOOL_NAMES.PROPOSE_PLAYDATE,
    description:
      'Plan a playdate step by step. Put EVERY detail the parent already gave (child, day, time, friends, activity, place). ' +
      'It saves them in the plan draft (nothing is created), then shows the options of the next missing step, ' +
      'or the summary to confirm when nothing is missing. Call it with startNew=true to begin a new plan. ' +
      'When activity and place are known, also send an agenda of 3-5 concrete games or activities (short, no times).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        startNew: { type: 'boolean', description: 'Start a new plan (drops the current draft)' },
        hostChildId: { type: 'string', description: "Id of the parent's own child (from getMyChildren)" },
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
            '3-5 concrete games or activities of the playdate (what the children play or make), a few words each, ' +
            'no times, no warm-up / getting to know each other / goodbye items',
        },
        note: { type: 'string', description: 'Extra request of the parent that is not a field (e.g. what to bring)' },
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
