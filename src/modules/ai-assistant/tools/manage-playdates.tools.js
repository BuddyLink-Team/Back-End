import playdateService from '../../playdate/playdate.service.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES, AI_CONFIRM_STEPS } from '../ai-assistant.constants.js';

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
    const query = {
      status: args.status && args.status !== 'all' ? args.status : 'upcoming',
      ...(args.childId ? { childId: args.childId } : {}),
    };
    const { playdates } = await playdateService.getPlaydates(ctx.userId, query);

    const formatted = (playdates || []).slice(0, 10).map((p) => ({
      id: p.id,
      activity: p.activity,
      date: p.scheduledDate ? new Date(p.scheduledDate).toISOString().slice(0, 10) : '',
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
    ctx.turn.cards.push({
      type: AI_CARD_TYPES.CHOICES,
      stepId: AI_CONFIRM_STEPS.RESCHEDULE,
      title: 'Xác nhận dời lịch hẹn chơi?',
      description: `Đề xuất đổi lịch sang ngày ${args.newDate} lúc ${args.newStartTime}.`,
      options: [
        {
          id: `reschedule:confirm:${args.playdateId}`,
          label: `Xác nhận đổi sang ${args.newDate} ${args.newStartTime}`,
          data: {
            playdateId: args.playdateId,
            newDate: args.newDate,
            newStartTime: args.newStartTime,
            reason: args.reason || '',
            confirm: true,
          },
        },
        {
          id: `reschedule:dismiss:${args.playdateId}`,
          label: 'Hủy bỏ',
          data: { playdateId: args.playdateId, dismiss: true },
        },
      ],
    });

    return {
      needsConfirmation: true,
      playdateId: args.playdateId,
      newDate: args.newDate,
      newStartTime: args.newStartTime,
      message: 'Vui lòng xác nhận trên thẻ để gửi yêu cầu dời lịch hẹn đến các phụ huynh trong nhóm.',
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
    ctx.turn.cards.push({
      type: AI_CARD_TYPES.CHOICES,
      stepId: AI_CONFIRM_STEPS.CANCEL,
      title: 'Xác nhận hủy buổi hẹn chơi?',
      description: 'Thao tác này sẽ thông báo đến tất cả phụ huynh tham gia và không thể hoàn tác.',
      options: [
        {
          id: `cancel:confirm:${args.playdateId}`,
          label: 'Xác nhận hủy hẹn',
          data: { playdateId: args.playdateId, reason: args.reason || '', confirm: true },
        },
        {
          id: `cancel:dismiss:${args.playdateId}`,
          label: 'Giữ lại lịch hẹn',
          data: { playdateId: args.playdateId, dismiss: true },
        },
      ],
    });
    return {
      needsConfirmation: true,
      playdateId: args.playdateId,
      message: 'Bạn có chắc chắn muốn hủy buổi hẹn chơi này không? Vui lòng xác nhận trên thẻ để hoàn tất.',
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
    const isAccept = args.status === 'accepted';
    ctx.turn.cards.push({
      type: AI_CARD_TYPES.CHOICES,
      stepId: AI_CONFIRM_STEPS.RESPOND,
      title: isAccept ? 'Xác nhận tham gia hẹn chơi?' : 'Xác nhận từ chối lời mời?',
      description: isAccept
        ? 'Bạn sẽ được thêm vào nhóm chat của buổi hẹn chơi này.'
        : 'Người tổ chức sẽ nhận được thông báo từ chối của bạn.',
      options: [
        {
          id: `respond:confirm:${args.playdateId}`,
          label: isAccept ? 'Đồng ý tham gia' : 'Từ chối lời mời',
          data: { playdateId: args.playdateId, status: args.status, confirm: true },
        },
        {
          id: `respond:dismiss:${args.playdateId}`,
          label: 'Để sau',
          data: { playdateId: args.playdateId, dismiss: true },
        },
      ],
    });

    return {
      needsConfirmation: true,
      playdateId: args.playdateId,
      status: args.status,
      message: `Vui lòng xác nhận trên thẻ để ${isAccept ? 'đồng ý tham gia' : 'từ chối'} buổi hẹn chơi.`,
    };
  },
};

