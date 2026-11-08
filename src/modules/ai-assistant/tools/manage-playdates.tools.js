import playdateService from '../../playdate/playdate.service.js';
import AppError from '../../../shared/exceptions/app-error.js';
import { AI_TOOL_NAMES, AI_CONFIRM_STEPS } from '../ai-assistant.constants.js';
import { makeChoiceCard } from './plan-steps.js';

const toDay = (date) => (date ? new Date(date).toISOString().slice(0, 10) : '');

/**
 * The playdate the model refers to, when the parent can see it (the id comes from the model)
 * @returns {Promise<Object|null>}
 */
const findOwnPlaydate = async (ctx, playdateId) => {
  try {
    return await playdateService.getPlaydateForParent(ctx.userId, String(playdateId));
  } catch (error) {
    if (error instanceof AppError && error.isOperational) return null;
    throw error;
  }
};

const playdateNotFound = () => ({
  error: { code: 'PLAYDATE_NOT_FOUND', message: 'No playdate of this parent has this id: call listMyPlaydates first.' },
});

/**
 * Confirmation card of an action on a playdate: nothing runs until the parent taps "confirm"
 * (choice-handler.js runs it with the stored option data)
 */
const pushConfirmCard = (ctx, { stepId, playdateId, title, description, confirmLabel, dismissLabel, data }) => {
  ctx.turn.cards.push(
    makeChoiceCard({
      stepId,
      title,
      description,
      options: [
        { id: `${stepId}:confirm:${playdateId}`, label: confirmLabel, description: '', data: { ...data, playdateId, confirm: true }, links: [] },
        { id: `${stepId}:dismiss:${playdateId}`, label: dismissLabel, description: '', data: { playdateId, dismiss: true }, links: [] },
      ],
    })
  );
};

const describePlaydate = (playdate) =>
  `"${playdate.activity}" lúc ${playdate.time} ngày ${toDay(playdate.scheduledDate).split('-').reverse().join('/')}`;

export const listMyPlaydatesTool = {
  declaration: {
    name: AI_TOOL_NAMES.LIST_MY_PLAYDATES,
    description:
      "List the parent's playdates (upcoming, past, or all) with date, time, activity, venue, and participating children. " +
      "Call this when the parent asks what playdates are scheduled, e.g. 'Tuần này bé có hẹn gì?', 'Lịch chơi sắp tới'.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['upcoming', 'completed', 'cancelled', 'all'], description: 'Default upcoming' },
        childId: { type: 'string', description: 'Optional: filter for a specific child' },
      },
    },
  },

  async execute(args, ctx) {
    const status = args.status || 'upcoming';
    const query = {
      ...(status !== 'all' ? { status } : {}),
      ...(args.childId ? { childId: args.childId } : {}),
    };
    const { playdates } = await playdateService.getPlaydates(ctx.userId, query);

    const formatted = (playdates || []).slice(0, 10).map((p) => ({
      id: p.id,
      activity: p.activity,
      date: toDay(p.scheduledDate),
      time: p.time,
      status: p.status,
      placeName: p.location?.name || '',
      placeAddress: p.location?.address || '',
      hostChild: p.hostChild?.displayName || '',
      participants: (p.participants || []).map((part) => part.child?.displayName || part.parent?.fullName || ''),
      isHost: p.isHost,
    }));

    return { playdates: formatted, count: formatted.length };
  },
};

export const reschedulePlaydateTool = {
  declaration: {
    name: AI_TOOL_NAMES.RESCHEDULE_PLAYDATE,
    description:
      "Request to reschedule an upcoming playdate to a new date or time. " +
      "Always presents a confirmation card for the parent to confirm before executing.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        playdateId: { type: 'string', description: 'ID of the playdate to reschedule' },
        newDate: { type: 'string', description: 'YYYY-MM-DD' },
        newStartTime: { type: 'string', description: 'HH:mm (24h)' },
        reason: { type: 'string', description: 'Reason for rescheduling' },
      },
      required: ['playdateId', 'newDate', 'newStartTime'],
    },
  },

  async execute(args, ctx) {
    const playdate = await findOwnPlaydate(ctx, args.playdateId);
    if (!playdate) return playdateNotFound();
    const when = `${args.newDate.split('-').reverse().join('/')} lúc ${args.newStartTime}`;
    pushConfirmCard(ctx, {
      stepId: AI_CONFIRM_STEPS.RESCHEDULE,
      playdateId: playdate.id,
      title: 'Xác nhận dời lịch hẹn chơi?',
      description: `${describePlaydate(playdate)} sẽ được đề xuất đổi sang ${when}. Các gia đình cần đồng ý lịch mới.`,
      confirmLabel: `Gửi đề xuất dời sang ${when}`,
      dismissLabel: 'Giữ lịch cũ',
      data: { newDate: args.newDate, newStartTime: args.newStartTime, reason: args.reason || '' },
    });
    return {
      needsConfirmation: true,
      playdateId: playdate.id,
      message: 'The confirmation card is shown: ask the parent to tap it. Nothing is sent yet.',
    };
  },
};

export const cancelPlaydateTool = {
  declaration: {
    name: AI_TOOL_NAMES.CANCEL_PLAYDATE,
    description:
      "Cancel an upcoming playdate. Call this when the parent says they want to cancel or cannot attend. " +
      "Always presents a confirmation card for the parent to confirm before executing.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        playdateId: { type: 'string', description: 'ID of the playdate to cancel' },
        reason: { type: 'string', description: 'Reason for cancellation' },
      },
      required: ['playdateId'],
    },
  },

  async execute(args, ctx) {
    const playdate = await findOwnPlaydate(ctx, args.playdateId);
    if (!playdate) return playdateNotFound();
    pushConfirmCard(ctx, {
      stepId: AI_CONFIRM_STEPS.CANCEL,
      playdateId: playdate.id,
      title: 'Xác nhận hủy buổi hẹn chơi?',
      description: `${describePlaydate(playdate)} sẽ bị hủy và các gia đình được thông báo. Không thể hoàn tác.`,
      confirmLabel: 'Xác nhận hủy hẹn',
      dismissLabel: 'Giữ lại lịch hẹn',
      data: { reason: args.reason || '' },
    });
    return {
      needsConfirmation: true,
      playdateId: playdate.id,
      message: 'The confirmation card is shown: ask the parent to tap it. Nothing is cancelled yet.',
    };
  },
};

export const respondInvitationTool = {
  declaration: {
    name: AI_TOOL_NAMES.RESPOND_INVITATION,
    description:
      "Respond to a playdate invitation (accept or decline). " +
      "Always presents a confirmation card for the parent to confirm before executing.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        playdateId: { type: 'string', description: 'ID of the playdate invitation' },
        status: { type: 'string', enum: ['accepted', 'declined'], description: 'Accept or decline' },
      },
      required: ['playdateId', 'status'],
    },
  },

  async execute(args, ctx) {
    const playdate = await findOwnPlaydate(ctx, args.playdateId);
    if (!playdate) return playdateNotFound();
    const isAccept = args.status === 'accepted';
    pushConfirmCard(ctx, {
      stepId: AI_CONFIRM_STEPS.RESPOND,
      playdateId: playdate.id,
      title: isAccept ? 'Xác nhận tham gia hẹn chơi?' : 'Xác nhận từ chối lời mời?',
      description: isAccept
        ? `Bạn sẽ tham gia ${describePlaydate(playdate)} và vào nhóm chat của buổi hẹn.`
        : `Người tổ chức ${describePlaydate(playdate)} sẽ nhận được thông báo từ chối của bạn.`,
      confirmLabel: isAccept ? 'Đồng ý tham gia' : 'Từ chối lời mời',
      dismissLabel: 'Để sau',
      data: { status: args.status },
    });
    return {
      needsConfirmation: true,
      playdateId: playdate.id,
      message: 'The confirmation card is shown: ask the parent to tap it. Nothing is answered yet.',
    };
  },
};
