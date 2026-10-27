import discoveryService from '../../discovery/discovery.service.js';
import { DISCOVERY_DEFAULTS } from '../../discovery/discovery.constants.js';
import AppError from '../../../shared/exceptions/AppError.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES, AI_STEPS, AI_LIMITS, AI_OPTION_IDS } from '../ai-assistant.constants.js';
import { makeChoiceCard } from './plan-steps.js';
import { toMatchItem, tagsOf } from './tool-sanitizer.js';

const MAX_AGE = 18;
const MAX_DISTANCE_KM = 50;

const toInt = (value, min, max) => {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
};
const toInterests = (value) =>
  (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, AI_LIMITS.MAX_OPTIONS);

/**
 * Search criteria for one own child: defaults from the child profile and the parent's preferences,
 * overridden by what the parent asked for
 * @param {Object} child - Own child item
 * @param {Object} parent - Parent document
 * @param {Object} [overrides] - { ageMin, ageMax, interests, maxDistanceKm }
 * @returns {Object}
 */
export const buildCriteria = (child, parent, overrides = {}) => {
  const age = child.age ?? 0;
  const ageMin = toInt(overrides.ageMin, 0, MAX_AGE) ?? Math.max(0, age - 1);
  const ageMax = toInt(overrides.ageMax, 0, MAX_AGE) ?? age + 1;
  return {
    childId: child.childId,
    childName: child.displayName,
    ageMin: Math.min(ageMin, ageMax),
    ageMax: Math.max(ageMin, ageMax),
    // Strict filter only when the parent named interests; the child's own tags rank the results anyway
    interests: toInterests(overrides.interests),
    preferInterests: [...(child.interests || []), ...(child.favoriteActivities || [])].slice(0, AI_LIMITS.MAX_OPTIONS),
    maxDistanceKm:
      toInt(overrides.maxDistanceKm, 1, MAX_DISTANCE_KM) ??
      parent.preferences?.maxDistanceKm ??
      DISCOVERY_DEFAULTS.DEFAULT_MAX_DISTANCE_KM,
  };
};

const criteriaText = (criteria) =>
  [
    `${criteria.ageMin}–${criteria.ageMax} tuổi`,
    criteria.interests.length
      ? `thích ${criteria.interests.join(', ')}`
      : criteria.preferInterests.length
        ? `ưu tiên bạn thích ${criteria.preferInterests.join(', ')}`
        : null,
    `trong ${criteria.maxDistanceKm} km`,
  ]
    .filter(Boolean)
    .join(' · ');

const findOwnChild = async (ctx, childId) => {
  const children = await ctx.getChildren();
  if (!children.length) {
    throw new AppError('Add a child profile first', 400, 'NO_CHILD_PROFILE');
  }
  if (childId) {
    const child = children.find((item) => item.childId === String(childId));
    if (!child) throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    return { child, children };
  }
  return { child: children.length === 1 ? children[0] : null, children };
};

/**
 * Run the Discovery search with confirmed criteria. Reads profiles only: no swipe, no discovery quota.
 * @param {Object} ctx
 * @param {Object} criteria - From buildCriteria
 * @returns {Promise<Object>} Result for the model
 */
export const searchMatches = async (ctx, criteria) => {
  const { child } = await findOwnChild(ctx, criteria.childId);
  const { profiles } = await discoveryService.getDiscoveryProfiles(ctx.userId, {
    childId: child.childId,
    ageMin: criteria.ageMin,
    ageMax: criteria.ageMax,
    interests: criteria.interests.length ? criteria.interests.join(',') : undefined,
    maxDistanceKm: criteria.maxDistanceKm,
  });
  const items = profiles.slice(0, AI_LIMITS.MAX_MATCHES).map((profile) => toMatchItem(profile, tagsOf(child)));
  ctx.turn.cards.push({ type: AI_CARD_TYPES.MATCH_SUGGESTIONS, forChildId: child.childId, criteria, items });
  return {
    forChild: child.displayName,
    criteria: criteriaText(criteria),
    matches: items.map((item) => ({
      name: item.displayName,
      age: item.age,
      sharedInterests: item.sharedInterests,
      matchScore: item.matchScore,
      distanceKm: item.distanceKm,
      parentArea: item.parent.area,
    })),
    ...(items.length ? {} : { note: 'No match: suggest widening the age range or the distance.' }),
  };
};

export const findMatchesTool = {
  declaration: {
    name: AI_TOOL_NAMES.FIND_MATCHES,
    description:
      'Find children nearby who would be good playmates for one of the parent\'s children (Discovery, read only). ' +
      'Use confirmed=false when the parent did not say which child or which criteria: it shows the default criteria for the parent to confirm. ' +
      'Use confirmed=true when the parent gave criteria (age, interests, distance) or already confirmed them.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        confirmed: { type: 'boolean', description: 'true to search now, false to ask the parent to confirm the criteria first' },
        childId: { type: 'string', description: "Id of the parent's own child (from getMyChildren)" },
        ageMin: { type: 'integer', minimum: 0, maximum: MAX_AGE },
        ageMax: { type: 'integer', minimum: 0, maximum: MAX_AGE },
        interests: { type: 'array', items: { type: 'string' }, description: 'Only when the parent asked for specific interests' },
        maxDistanceKm: { type: 'integer', minimum: 1, maximum: MAX_DISTANCE_KM },
      },
      required: ['confirmed'],
    },
  },

  async execute(args, ctx) {
    const { child, children } = await findOwnChild(ctx, args.childId);

    if (args.confirmed && child) {
      return searchMatches(ctx, buildCriteria(child, ctx.parent, args));
    }

    // Ask first: the default criteria of the child (or of each child when the parent has several)
    const targets = child ? [child] : children;
    const options = targets.map((target) => {
      const criteria = buildCriteria(target, ctx.parent, args);
      return {
        id: child ? AI_OPTION_IDS.CRITERIA_CONFIRM : `criteria:${target.childId}`,
        label: child ? 'Đúng, tìm luôn' : `Tìm cho bé ${target.displayName}`,
        description: `Bé ${target.displayName}: ${criteriaText(criteria)}`,
        data: criteria,
        links: [],
      };
    });
    ctx.turn.cards.push(
      makeChoiceCard({
        stepId: AI_STEPS.MATCH_CRITERIA,
        title: child ? `Tìm bạn cho bé ${child.displayName}` : 'Tìm bạn cho bé nào?',
        options,
        allowCustom: true,
      })
    );
    return {
      waitingFor: 'The parent confirms or edits these criteria by tapping the card',
      criteria: options.map((option) => option.description),
    };
  },
};

export default findMatchesTool;
