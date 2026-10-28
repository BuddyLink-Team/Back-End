import AppError from '../../../shared/exceptions/AppError.js';
import { PLACE_TYPES } from '../../places/places.constants.js';
import { AI_TOOL_NAMES, AI_STEPS } from '../ai-assistant.constants.js';
import { isValidDate } from '../plan-draft.rules.js';
import { showStep } from './plan-steps.js';

/**
 * The planning suggestions of the Create Playdate form (BUD-48), for the playdate being planned.
 * proposePlaydate already shows the next step; these let the model show a step again on request
 * (e.g. "other times on Sunday", "only kids cafés").
 */

const requirePlan = (ctx) => {
  if (!ctx.draft) {
    throw new AppError('No playdate is being planned: call proposePlaydate first', 400, 'NO_PLAN');
  }
  return ctx.draft;
};

export const suggestTimeSlotsTool = {
  declaration: {
    name: AI_TOOL_NAMES.SUGGEST_TIME_SLOTS,
    description:
      'Show free time slots for the playdate being planned (families\' preferred days and times, no clash with the children\'s other playdates). Optionally for one day only.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, to only show slots on that day' },
      },
    },
  },
  async execute(args, ctx) {
    const draft = requirePlan(ctx);
    if (args.date && isValidDate(args.date)) draft.preferredDate = args.date;
    return showStep(AI_STEPS.TIME, ctx);
  },
};

export const findAvailablePlaymatesTool = {
  declaration: {
    name: AI_TOOL_NAMES.FIND_AVAILABLE_PLAYMATES,
    description:
      "Show the children of the parent's friends who can be invited (paired playmates first), without those busy at the chosen time.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  async execute(_args, ctx) {
    requirePlan(ctx);
    return showStep(AI_STEPS.PLAYMATES, ctx);
  },
};

export const suggestActivitiesTool = {
  declaration: {
    name: AI_TOOL_NAMES.SUGGEST_ACTIVITIES,
    description: 'Show activities the children of the playdate being planned share an interest in.',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  async execute(_args, ctx) {
    requirePlan(ctx);
    return showStep(AI_STEPS.ACTIVITY, ctx);
  },
};

export const suggestPlacesTool = {
  declaration: {
    name: AI_TOOL_NAMES.SUGGEST_PLACES,
    description:
      'Show places between the families of the playdate being planned, suited to the chosen activity (or to one place type).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: Object.values(PLACE_TYPES) },
      },
    },
  },
  async execute(args, ctx) {
    requirePlan(ctx);
    const type = Object.values(PLACE_TYPES).includes(args.type) ? args.type : undefined;
    return showStep(AI_STEPS.PLACE, ctx, { type });
  },
};
