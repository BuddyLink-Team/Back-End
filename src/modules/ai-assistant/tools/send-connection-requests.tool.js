import discoveryService from '../../discovery/discovery.service.js';
import AppError from '../../../shared/exceptions/app-error.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES, AI_STEPS } from '../ai-assistant.constants.js';
import { makeChoiceCard } from './plan-steps.js';
import { normalizeName } from './propose-playdate.tool.js';

/**
 * Connection requests ("kết bạn") to children of the last playmate list. They are not friends yet, so
 * this is a Discovery Like each, never a playdate invitation. The tool only shows the card: the requests
 * are sent when the parent confirms it (choice-handler.js sendConnectionRequests).
 */

// Latest playmate list: shown in this turn, otherwise in an earlier reply
const latestMatchCard = (ctx) =>
  [...ctx.turn.cards].reverse().find((card) => card.type === AI_CARD_TYPES.MATCH_SUGGESTIONS) || ctx.lastMatchCard || null;

export const sendConnectionRequestsTool = {
  declaration: {
    name: AI_TOOL_NAMES.SEND_CONNECTION_REQUESTS,
    description:
      'Prepare connection requests (kết bạn) to children of the last playmate list shown by findMatches. ' +
      'Use it when the parent asks to invite, connect with or send a request to children of that list ' +
      '("gửi lời mời cho bé A và B"): they are not friends yet, so this is NOT a playdate. ' +
      'It shows a card with these children ticked; nothing is sent until the parent confirms it.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, description: 'Names of the children the parent named' },
        childIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },

  async execute(args, ctx) {
    const card = latestMatchCard(ctx);
    if (!card?.items?.length) {
      throw new AppError('No playmate list was shown yet: call findMatches first', 400, 'NO_MATCH_LIST');
    }

    const ids = new Set((args.childIds || []).map(String));
    const names = (args.names || []).map(String).filter(Boolean);
    const wanted = (item) =>
      ids.has(item.childId) || names.some((name) => normalizeName(name) === normalizeName(item.displayName));
    const notFound = names.filter((name) => !card.items.some((item) => normalizeName(item.displayName) === normalizeName(name)));

    const options = card.items.map((item) => ({
      id: `connect:${item.childId}`,
      label: item.displayName,
      description: [item.age !== null ? `${item.age} tuổi` : null, `bé nhà ${item.parent.fullName}`].filter(Boolean).join(' · '),
      data: { childId: item.childId, forChildId: card.forChildId || null },
      links: [{ kind: 'child_profile', childId: item.childId }],
    }));
    ctx.turn.cards.push(
      makeChoiceCard({
        stepId: AI_STEPS.CONNECT,
        title: 'Gửi lời mời kết bạn',
        options,
        selectionMode: 'multiple',
        preselectedOptionIds: options.filter((option, index) => wanted(card.items[index])).map((option) => option.id),
      })
    );

    return {
      ticked: card.items.filter(wanted).map((item) => item.displayName),
      ...(notFound.length ? { notInList: notFound } : {}),
      waitingFor: 'The parent confirms the requests on the card (they are sent as Discovery likes)',
    };
  },
};

/**
 * Send the confirmed requests, one Discovery like each (same quota and checks as a swipe)
 * @param {Object} ctx
 * @param {Array<Object>} options - Picked options of the connect card
 * @returns {Promise<Array<{ name: string, status: string }>>}
 */
export const sendConnectionRequests = async (ctx, options) => {
  const results = [];
  for (const option of options) {
    try {
      const { connection } = await discoveryService.swipeProfile(
        ctx.userId,
        option.data.childId,
        true,
        option.data.forChildId || undefined
      );
      results.push({ name: option.label, status: connection?.isMatched ? 'matched' : 'sent' });
    } catch (error) {
      if (!(error instanceof AppError) || !error.isOperational) throw error;
      results.push({ name: option.label, status: error.code === 'DUPLICATE_SWIPE' ? 'already_sent' : 'failed', code: error.code });
      if (error.code === 'QUOTA_EXCEEDED') {
        ctx.turn.cards.push({
          type: AI_CARD_TYPES.QUOTA_NOTICE,
          feature: error.details?.feature ?? null,
          limit: error.details?.limit ?? null,
          resetAt: error.details?.resetAt ?? null,
        });
        break;
      }
    }
  }
  return results;
};

export default sendConnectionRequestsTool;
