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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PARTICIPANT_STATUS_TEXT = Object.freeze({ accepted: 'đã nhận lời', pending: 'chưa trả lời', declined: 'đã từ chối' });
const DISPLAY_STATUS_TEXT = Object.freeze({
  pending: 'đang chờ trả lời',
  confirmed: 'đã chốt',
  declined: 'bạn đã từ chối',
  completed: 'đã diễn ra',
  cancelled: 'đã hủy',
  upcoming: 'sắp diễn ra',
});

export const listMyPlaydatesTool = {
  declaration: {
    name: AI_TOOL_NAMES.LIST_MY_PLAYDATES,
    description:
      "List the parent's playdates with date, time, activity, place, the children and each family's answer. " +
      "Call it for 'Tuần này bé có hẹn gì?', 'Lịch chơi sắp tới', 'Có lời mời nào chưa trả lời?', and before rescheduling, " +
      'cancelling or answering a playdate whose id is not known yet.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['upcoming', 'pending', 'confirmed', 'completed', 'cancelled', 'all'],
          description: 'Default upcoming. pending = an answer is awaited (invitations to answer, or invitees not answered yet)',
        },
        fromDate: { type: 'string', description: 'YYYY-MM-DD, first day (from the calendar of the prompt)' },
        toDate: { type: 'string', description: 'YYYY-MM-DD, last day included' },
        childId: { type: 'string', description: 'Optional: only the playdates of one own child' },
      },
    },
  },

  async execute(args, ctx) {
    const status = args.status || 'upcoming';
    const query = {
      ...(status !== 'all' ? { status } : {}),
      ...(args.childId ? { childId: args.childId } : {}),
      ...(DATE_ONLY.test(String(args.fromDate || '')) ? { fromDate: args.fromDate } : {}),
      ...(DATE_ONLY.test(String(args.toDate || '')) ? { toDate: args.toDate } : {}),
    };
    const { playdates } = await playdateService.getPlaydates(ctx.userId, query);

    // The list query has no child filter: one own child's playdates are picked here
    const childId = args.childId ? String(args.childId) : null;
    const ofChild = (p) =>
      !childId ||
      (p.hostChildIds || []).includes(childId) ||
      (p.myChildIds || []).includes(childId) ||
      (p.participants || []).some((part) => part.childId === childId);
    const formatted = (playdates || []).filter(ofChild).slice(0, 10).map((p) => ({
      id: p.id,
      activity: p.activity,
      date: toDay(p.scheduledDate),
      time: p.endTime ? `${p.time}-${p.endTime}` : p.time,
      status: DISPLAY_STATUS_TEXT[p.displayStatus] || DISPLAY_STATUS_TEXT[p.status] || p.status,
      placeName: p.location?.name || '',
      hostChildren: (p.hostChildren?.length ? p.hostChildren : [p.hostChild]).filter(Boolean).map((child) => child.displayName).join(', '),
      hostParent: p.isHost ? 'bạn' : p.hostParent?.fullName || '',
      isHost: p.isHost,
      // The viewer's own answer to an invitation
      ...(p.isHost ? {} : { myAnswer: PARTICIPANT_STATUS_TEXT[p.myParticipantStatus] || p.myParticipantStatus || '' }),
      participants: (p.participants || []).map((part) => ({
        child: part.child?.displayName || '',
        family: part.parent?.fullName || '',
        answer: PARTICIPANT_STATUS_TEXT[part.status] || part.status,
      })),
      ...(p.otherPendingCount ? { otherFamiliesNotAnswered: p.otherPendingCount } : {}),
    }));

    return {
      playdates: formatted,
      count: formatted.length,
      ...(formatted.length ? {} : { note: 'No playdate matches: say so and offer to plan one.' }),
    };
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
