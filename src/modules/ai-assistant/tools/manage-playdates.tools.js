import playdateService from '../../playdate/playdate.service.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES } from '../ai-assistant.constants.js';

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
      "Call this when the parent asks to change the time or day of a playdate, e.g. 'Dời lịch sang Chủ nhật', 'Đổi sang 15:00'.",
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
    const result = await playdateService.createRescheduleRequest(ctx.userId, args.playdateId, {
      newDate: args.newDate,
      newStartTime: args.newStartTime,
      reason: args.reason || '',
    });
    return {
      success: true,
      playdateId: args.playdateId,
      newDate: args.newDate,
      newStartTime: args.newStartTime,
      status: result.status,
      message: 'Đã gửi yêu cầu dời lịch hẹn đến các phụ huynh trong nhóm.',
    };
  },
};

export const cancelPlaydateTool = {
  declaration: {
    name: AI_TOOL_NAMES.CANCEL_PLAYDATE,
    description:
      "Cancel an upcoming playdate. Call this when the parent says they want to cancel or cannot attend, " +
      "e.g. 'Hủy hẹn với Bin', 'Bé ốm không đi được'. If confirm=false, ask for confirmation first.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        playdateId: { type: 'string', description: 'ID of the playdate to cancel' },
        reason: { type: 'string', description: 'Reason for cancellation' },
        confirm: { type: 'boolean', description: 'Must be true to execute cancellation' },
      },
      required: ['playdateId'],
    },
  },

  async execute(args, ctx) {
    if (!args.confirm) {
      ctx.turn.cards.push({
        type: AI_CARD_TYPES.CHOICES,
        stepId: 'cancel_confirm',
        title: 'Xác nhận hủy buổi hẹn chơi?',
        description: 'Thao tác này sẽ thông báo đến tất cả phụ huynh tham gia và không thể hoàn tác.',
        options: [
          {
            id: `cancel:confirm:${args.playdateId}`,
            label: 'Xác nhận hủy hẹn',
            data: { playdateId: args.playdateId, confirm: true },
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
    }

    await playdateService.cancelPlaydate(ctx.userId, args.playdateId, args.reason || 'Hủy theo yêu cầu của phụ huynh');
    return {
      success: true,
      cancelled: true,
      playdateId: args.playdateId,
      message: 'Buổi hẹn chơi đã được hủy thành công.',
    };
  },
};

export const respondInvitationTool = {
  declaration: {
    name: AI_TOOL_NAMES.RESPOND_INVITATION,
    description:
      "Respond to a playdate invitation (accept or decline). " +
      "Call this when the parent says 'Đồng ý tham gia hẹn chơi', 'Từ chối lời mời', etc.",
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
    await playdateService.respondToPlaydate(ctx.userId, args.playdateId, args.status);
    return {
      success: true,
      playdateId: args.playdateId,
      status: args.status,
      message: args.status === 'accepted' ? 'Đã chấp nhận lời mời tham gia hẹn chơi.' : 'Đã từ chối lời mời.',
    };
  },
};

