import playdateService from '../../playdate/playdate.service.js';
import AppError from '../../../shared/exceptions/app-error.js';
import {
  AI_CARD_TYPES,
  AI_CHOICE_STATUS,
  AI_STEPS,
  AI_CONFIRM_STEP,
  AI_OPTION_IDS,
  AI_MESSAGE_ROLES,
  AI_LIMITS,
} from '../ai-assistant.constants.js';
import { isValidDate, isValidTime, isPastSlot, normalizeAgenda, nextMissingStep, toDraftResponse } from '../plan-draft.rules.js';
import { advancePlan } from './plan-steps.js';
import { applyPlanFields, setLocation } from './propose-playdate.tool.js';
import { buildCriteria, searchMatches } from './find-matches.tool.js';
import { sendConnectionRequests } from './send-connection-requests.tool.js';

const invalidChoice = (message = 'This choice is no longer available') =>
  new AppError(message, 400, 'AI_INVALID_CHOICE');

// Cards a tap can answer: choice cards, and the summary card of a plan (its confirm button)
const isAnswerable = (card, stepId) =>
  card.stepId === stepId && (card.type === AI_CARD_TYPES.CHOICES || card.type === AI_CARD_TYPES.PLAYDATE_DRAFT);

/**
 * The open card a tap refers to. Only the latest summary card can be confirmed: an older one shows a
 * previous version of the plan.
 * @param {Object} session
 * @param {{ messageId: string, stepId: string }} choice
 * @returns {{ message: Object, card: Object, cardIndex: number }}
 */
const findOpenCard = (session, { messageId, stepId }) => {
  const messages = session.messages || [];
  const message = messages.find(
    (item) => item._id?.toString() === String(messageId) && item.role === AI_MESSAGE_ROLES.ASSISTANT
  );
  const cardIndex = (message?.cards || []).findIndex((card) => isAnswerable(card, stepId));
  const card = cardIndex === -1 ? null : message.cards[cardIndex];
  if (!card || card.status !== AI_CHOICE_STATUS.OPEN) throw invalidChoice();
  if (card.type === AI_CARD_TYPES.PLAYDATE_DRAFT) {
    const latest = [...messages].reverse().find((item) => (item.cards || []).some((c) => c.type === AI_CARD_TYPES.PLAYDATE_DRAFT));
    if (latest !== message) throw invalidChoice();
  }
  return { message, card, cardIndex };
};

/**
 * Options picked on the card. Only option ids of this card are accepted, and the stored option data is
 * used, never values sent by the client.
 */
const pickOptions = (card, optionIds = [], custom) => {
  const ids = [...new Set(optionIds.map(String))];
  if (ids.includes(AI_OPTION_IDS.SKIP)) {
    if (!card.allowSkip || ids.length > 1) throw invalidChoice();
    return { skipped: true, options: [] };
  }
  const options = ids.map((id) => (card.options || []).find((option) => option.id === id));
  if (options.some((option) => !option)) throw invalidChoice();
  if (custom) {
    if (!card.allowCustom || options.length) throw invalidChoice();
    return { skipped: false, options: [] };
  }
  const tooMany = card.selectionMode === 'single' && options.length !== 1;
  if (!options.length || tooMany) throw invalidChoice();
  return { skipped: false, options };
};

const requirePlan = (ctx) => {
  if (!ctx.draft) throw invalidChoice('No playdate is being planned');
  return ctx.draft;
};

const customText = (custom, key = 'text') => String(custom?.[key] || '').trim().slice(0, 500);

/**
 * Create the playdate of a complete plan (same checks as POST /playdates). The plan is closed on success.
 * @returns {Promise<{ result: Object, playdateId: string|null }>}
 */
const createFromPlan = async (ctx) => {
  const draft = requirePlan(ctx);
  if (nextMissingStep(draft) !== AI_CONFIRM_STEP) throw invalidChoice('The plan is not complete yet');
  const body = toDraftResponse(draft);
  try {
    const playdate = await playdateService.createPlaydate(ctx.userId, {
      hostChildId: body.hostChildId,
      scheduledDate: new Date(body.scheduledDate),
      time: body.time,
      durationMinutes: body.durationMinutes,
      activity: body.activity,
      location: body.location,
      participants: body.participants.map(({ parentId, childId }) => ({ parentId, childId })),
      note: body.note,
    });
    ctx.draft = null;
    return {
      playdateId: playdate.id,
      result: {
        created: true,
        invited: body.participants.map((participant) => participant.childName),
        busyInvitees: (playdate.warnings || []).length,
      },
    };
  } catch (error) {
    if (!(error instanceof AppError) || !error.isOperational) throw error;
    if (error.code === 'QUOTA_EXCEEDED') {
      ctx.turn.cards.push({
        type: AI_CARD_TYPES.QUOTA_NOTICE,
        feature: error.details?.feature ?? null,
        limit: error.details?.limit ?? null,
        resetAt: error.details?.resetAt ?? null,
      });
    }
    return { playdateId: null, result: { created: false, error: { code: error.code, message: error.message } } };
  }
};

// What the model is asked to do after a tap, by outcome
const NOTES = Object.freeze({
  default:
    'Reply in 1-2 short sentences about the options now shown (do not list them, the card shows them). ' +
    'If the result has warnings, mention them in a few words. Do not call tools unless something is missing ' +
    '(e.g. the agenda at the agenda step).',
  custom:
    'The parent typed their own answer: check that it fits the plan (children\'s ages, time of day, the other ' +
    'families, the warnings of the result) and warn in one short sentence if something does not fit, then continue.',
  connect:
    'Tell the parent in 1-2 short sentences which requests were sent (status sent / matched = already friends now / ' +
    'already_sent / failed). They can plan a playdate once the other parent accepts (followed in [[Kết nối]]). Do not call tools.',
  created:
    'The playdate is created and the invitations are sent; the plan is closed. Reply in 1-2 warm sentences: ' +
    'congratulate the parent, wish the children a fun time and say they can see it in [[Hẹn chơi]]. Do not call tools.',
  createFailed:
    'Creating the playdate failed: explain the error simply and suggest what to change; the parent can tap again ' +
    'or tell you the change (then call proposePlaydate with it).',
});

/**
 * Apply the picked option(s) to the plan draft or run the confirmed action, by code (the model only
 * comments afterwards). Adds the next step's card to the turn.
 * @param {Object} ctx - Tool context
 * @param {Object} session
 * @param {{ messageId: string, stepId: string, optionIds?: string[], custom?: Object }} choice
 * @returns {Promise<{ answeredCard: { messageId: Object, cards: Array<Object> }|null, note: string, allowTools: boolean }>}
 *   `note` tells the model what happened, it is never shown to the parent
 */
export const applyChoice = async (ctx, session, choice) => {
  const { message, card, cardIndex } = findOpenCard(session, choice);
  const custom = choice.custom && typeof choice.custom === 'object' ? choice.custom : null;
  const isConfirm = card.type === AI_CARD_TYPES.PLAYDATE_DRAFT;
  const { skipped, options } = isConfirm ? { skipped: false, options: [] } : pickOptions(card, choice.optionIds, custom);
  const picked = options.map((option) => option.label).join(', ');
  let result;
  let instruction = custom ? NOTES.custom : NOTES.default;
  let allowTools = true;
  let answered = {};
  let applied = true;

  switch (card.stepId) {
    case AI_STEPS.MATCH_CRITERIA: {
      const base = options[0]?.data || card.options[0]?.data;
      const childId = custom?.childId || base?.childId;
      const child = (await ctx.getChildren()).find((item) => item.childId === String(childId));
      if (!child) throw invalidChoice();
      const criteria = custom ? buildCriteria(child, ctx.parent, custom) : base;
      result = await searchMatches(ctx, criteria);
      instruction = NOTES.default;
      break;
    }
    case AI_STEPS.CONNECT:
      result = { connectionRequests: await sendConnectionRequests(ctx, options) };
      instruction = NOTES.connect;
      allowTools = false;
      break;
    case AI_STEPS.CHILD:
    case AI_STEPS.PLAYMATES: {
      const draft = requirePlan(ctx);
      // Picked in the friend search of the card: setParticipants keeps friends' children only
      const searchedIds =
        card.stepId === AI_STEPS.PLAYMATES && Array.isArray(custom?.childIds)
          ? [...new Set(custom.childIds.map(String))].slice(0, AI_LIMITS.MAX_SEARCHED_INVITEES)
          : null;
      if (searchedIds) {
        if (!searchedIds.length) throw invalidChoice();
        await applyPlanFields(ctx, { participantChildIds: searchedIds });
        answered = { customAnswer: { text: draft.participants.map((participant) => participant.childName).join(', ') } };
        result = await advancePlan(ctx);
        break;
      }
      if (custom) {
        // A typed name: the model matches it (own children, friends' children) with proposePlaydate
        const text = customText(custom);
        if (!text) throw invalidChoice();
        applied = false;
        result = {
          typed: text,
          todo:
            card.stepId === AI_STEPS.CHILD
              ? 'Call proposePlaydate with the hostChildId of this child (from the children list), or say no child has this name.'
              : 'Call proposePlaydate with participantNames from this text; the result warns about names that are not friends.',
        };
        break;
      }
      await applyPlanFields(
        ctx,
        card.stepId === AI_STEPS.CHILD
          ? { hostChildId: options[0].data.childId }
          : skipped
            ? { noPlaymates: true }
            : { participantChildIds: options.map((option) => option.data.childId) }
      );
      result = await advancePlan(ctx);
      break;
    }
    case AI_STEPS.TIME: {
      requirePlan(ctx);
      const slot = custom || options[0].data;
      if (!isValidDate(slot.date) || !isValidTime(slot.time) || isPastSlot(slot.date, slot.time)) {
        throw new AppError('Pick a time in the future', 400, 'AI_INVALID_CHOICE');
      }
      await applyPlanFields(ctx, { date: slot.date, time: slot.time, durationMinutes: slot.durationMinutes });
      result = await advancePlan(ctx);
      break;
    }
    case AI_STEPS.ACTIVITY:
      requirePlan(ctx);
      if (custom && !customText(custom, 'title')) throw invalidChoice();
      await applyPlanFields(ctx, { activity: custom ? customText(custom, 'title') : options[0].data.title });
      result = await advancePlan(ctx);
      break;
    case AI_STEPS.PLACE: {
      const draft = requirePlan(ctx);
      const place = custom || options[0].data;
      if (!String(place.name || '').trim()) throw invalidChoice();
      setLocation(draft, place);
      result = await advancePlan(ctx);
      break;
    }
    case AI_STEPS.AGENDA: {
      const draft = requirePlan(ctx);
      // The card always sends the list as the parent left it (edited or not)
      const agenda = normalizeAgenda(custom?.agenda);
      if (!agenda.length) throw invalidChoice('Add at least one main activity');
      draft.agenda = agenda;
      draft.agendaConfirmed = true;
      answered = { customAnswer: { agenda } };
      result = await advancePlan(ctx);
      instruction = NOTES.default;
      break;
    }
    case AI_STEPS.EXTRA: {
      const draft = requirePlan(ctx);
      draft.extraDone = true;
      result = await advancePlan(ctx);
      if (custom) {
        const request = customText(custom, 'request');
        if (!request) throw invalidChoice();
        result = {
          ...result,
          extraRequest: request,
          todo:
            'Apply this request now with proposePlaydate: the changed fields (time, friends, place, agenda…), ' +
            'or note for anything else (e.g. what to bring). Warn if it does not fit. The summary is then shown again.',
        };
      }
      break;
    }
    case AI_CONFIRM_STEP: {
      const { result: outcome, playdateId } = await createFromPlan(ctx);
      result = outcome;
      if (!playdateId) {
        // The card stays open: the parent can confirm again once the problem is fixed
        return {
          answeredCard: null,
          note: `[System] The parent tapped "confirm". Result: ${JSON.stringify(result)}. ${NOTES.createFailed}`,
          allowTools: true,
        };
      }
      answered = { playdateId };
      instruction = NOTES.created;
      allowTools = false;
      break;
    }
    default:
      throw invalidChoice();
  }

  const cards = message.cards.map((item, index) =>
    index === cardIndex
      ? {
          ...item,
          status: AI_CHOICE_STATUS.ANSWERED,
          selectedOptionIds: skipped ? [AI_OPTION_IDS.SKIP] : options.map((option) => option.id),
          ...(custom && !answered.customAnswer ? { customAnswer: custom } : {}),
          ...answered,
        }
      : item
  );

  const what = isConfirm
    ? 'confirmed the summary'
    : skipped
      ? 'skipped this step'
      : custom
        ? `entered: ${JSON.stringify(custom)}`
        : `picked: ${picked}`;
  return {
    answeredCard: { messageId: message._id, cards },
    note: `[System] The parent ${what} (step "${card.stepId}").${applied ? ' This was applied already.' : ''} Result: ${JSON.stringify(result)}. ${instruction}`,
    allowTools,
  };
};

export default applyChoice;
