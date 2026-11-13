import logger from '../../shared/logger/index.js';
import notificationService from './notification.service.js';
import { NOTIFICATION_TYPES } from './notification.constants.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import playdateService from '../playdate/playdate.service.js';
import chatService from '../chat/chat.service.js';
import aiAssistantService from '../ai-assistant/ai-assistant.service.js';
import { onConnectionEvent, CONNECTION_EVENTS } from '../connection/connection.events.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';
import { onRatingEvent, RATING_EVENTS } from '../rating-feedback/rating-feedback.events.js';

const DEFAULT_PARENT_NAME = 'Một phụ huynh';
const REBOOKING_MIN_RATING = 4;

/**
 * Run a notification job without making the emitting request wait for it.
 * The connection/playdate event emitters await their handlers, so returning the job's
 * promise would delay the API response by every notification query.
 * @param {string} label - Used in the error log
 * @param {() => Promise<void>} job
 */
const runInBackground = (label, job) => {
  job().catch((err) => logger.error(`[NotificationListeners] ${label} failed: ${err.message}`));
};

// "Na ↔ bé Bin của bạn" when the request came from a discovery Like on a child, otherwise ''
const describeChildPair = async (childPair) => {
  if (!childPair?.forChildId || !childPair?.targetChildId) return '';
  const children = await childService.getActiveChildrenByIds([childPair.forChildId, childPair.targetChildId]);
  const nameOf = (id) => children.find((child) => child._id.toString() === id.toString())?.displayName;
  const requesterChildName = nameOf(childPair.forChildId);
  const recipientChildName = nameOf(childPair.targetChildId);
  return requesterChildName && recipientChildName ? `${requesterChildName} ↔ bé ${recipientChildName} của bạn` : '';
};

// Connection request sent -> notify the recipient parent
const notifyConnectionRequested = async ({ requesterParentId, recipientParentId, childPair }) => {
  const [requester, recipient, pairText] = await Promise.all([
    parentService.getParentById(requesterParentId),
    parentService.getParentById(recipientParentId),
    describeChildPair(childPair),
  ]);
  if (!recipient?.userId) return;

  const requesterName = requester?.fullName || DEFAULT_PARENT_NAME;
  await notificationService.createNotification({
    recipientId: recipient.userId,
    type: NOTIFICATION_TYPES.CONNECTION_REQUEST,
    title: 'Lời mời kết nối mới',
    body: pairText
      ? `${requesterName} đã gửi lời mời kết nối đến bạn: ${pairText}.`
      : `${requesterName} đã gửi lời mời kết nối đến bạn.`,
    data: { senderId: requesterParentId },
  });
};

// Connection request accepted -> notify the requester parent
const notifyConnectionAccepted = async ({ requesterId, recipientId }) => {
  if (!requesterId || !recipientId) return;

  const [requester, recipient] = await Promise.all([
    parentService.getParentById(requesterId),
    parentService.getParentById(recipientId),
  ]);
  if (!requester?.userId) return;

  const recipientName = recipient?.fullName || DEFAULT_PARENT_NAME;
  await notificationService.createNotification({
    recipientId: requester.userId,
    type: NOTIFICATION_TYPES.CONNECTION_ACCEPTED,
    title: 'Lời mời kết nối đã được chấp nhận',
    body: `${recipientName} đã đồng ý kết nối với bạn. Giờ hai bạn đã có thể trò chuyện!`,
    data: { senderId: recipientId },
  });
};

// Playdate invitation sent -> notify every invited parent concurrently
const notifyPlaydateInvited = async ({ playdateId, hostParentId, participantParentIds = [] }) => {
  const [host, playdate] = await Promise.all([
    parentService.getParentById(hostParentId),
    playdateService.getPlaydateById(playdateId),
  ]);

  const hostName = host?.fullName || DEFAULT_PARENT_NAME;
  const activity = playdate?.activity || 'buổi hẹn chơi';

  const results = await Promise.allSettled(
    participantParentIds.map(async (participantParentId) => {
      const participant = await parentService.getParentById(participantParentId);
      if (!participant?.userId) return;

      await notificationService.createNotification({
        recipientId: participant.userId,
        type: NOTIFICATION_TYPES.PLAYDATE_INVITE,
        title: 'Lời mời tham gia Playdate',
        body: `${hostName} đã mời bạn và bé tham gia "${activity}".`,
        data: { senderId: hostParentId, playdateId },
      });
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(
        `[NotificationListeners] Playdate invite notification failed for parent ${participantParentIds[index]}: ${result.reason?.message}`
      );
    }
  });
};

// Playdate starts in 24h / 1h -> notify the host and every accepted participant
const notifyPlaydateReminder = async ({
  playdateId,
  kind,
  activity,
  time,
  date,
  placeName,
  recipientParentIds = [],
  note = '',
  chatConversationId = null,
  missingChaperones = 0,
}) => {
  const isSoon = kind === 'h1';
  const where = placeName ? ` tại ${placeName}` : '';
  const title = isSoon ? 'Playdate sắp bắt đầu' : 'Nhắc lịch Playdate';

  let safetyNotePart = '';
  if (kind === 'h24' && note) {
    if (note.includes('Lưu ý an toàn:')) {
      const match = note.match(/Lưu ý an toàn:\s*([\s\S]*?)(?=\n\nLưu ý thêm:|$)/);
      if (match && match[1]) {
        safetyNotePart += `\nLưu ý an toàn:\n${match[1].trim()}`;
      }
    }
    if (note.includes('Lưu ý thêm:')) {
      const matchExtra = note.match(/Lưu ý thêm:\s*([\s\S]*?)$/);
      if (matchExtra && matchExtra[1]) {
        safetyNotePart += `\nLưu ý thêm / Đồ mang theo:\n${matchExtra[1].trim()}`;
      }
    }
  }

  // Not enough adults coming with the children yet (BUD-49 B5)
  const chaperonePart = missingChaperones > 0
    ? `\nCòn thiếu ${missingChaperones} người lớn đi kèm: bấm "Tôi sẽ đi kèm cùng các bé" trong nhóm chat.`
    : '';
  const body = isSoon
    ? `"${activity}" sẽ bắt đầu lúc ${time}${where}. Chuẩn bị lên đường nhé!${chaperonePart}`
    : `"${activity}" diễn ra lúc ${time} ngày ${date}${where}.${safetyNotePart}${chaperonePart}`;

  if (chatConversationId && kind === 'h24') {
    runInBackground('Playdate chat reminder message', async () => {
      await chatService.postSystemMessage(
        chatConversationId,
        `⏰ Nhắc lịch hẹn: "${activity}" diễn ra lúc ${time} ngày ${date}${where}.${safetyNotePart}${chaperonePart}`
      );
    });
  }

  const results = await Promise.allSettled(
    recipientParentIds.map(async (parentId) => {
      const parent = await parentService.getParentById(parentId);
      if (!parent?.userId) return;
      await notificationService.createNotification({
        recipientId: parent.userId,
        type: NOTIFICATION_TYPES.PLAYDATE_REMINDER,
        title,
        body,
        data: { playdateId },
      });
    })
  );
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) =>
      logger.error(`[NotificationListeners] Playdate reminder failed for playdate ${playdateId}: ${result.reason?.message}`)
    );
};

// A family who joined left -> tell the host, with the reason they gave. A leave after a block
// carries no reason (safetyExempt) and is worded like any other: the host never learns about the block.
const notifyPlaydateParticipantLeft = async ({ playdateId, hostParentId, leaverParentId, activity, isLate, reason }) => {
  const [host, leaver] = await Promise.all([
    parentService.getParentById(hostParentId),
    parentService.getParentById(leaverParentId),
  ]);
  if (!host?.userId) return;

  const leaverName = leaver?.fullName || DEFAULT_PARENT_NAME;
  const latePart = isLate ? ' sát giờ' : '';
  const reasonPart = reason ? ` Lý do: "${reason}".` : '';
  await notificationService.createNotification({
    recipientId: host.userId,
    type: NOTIFICATION_TYPES.PLAYDATE_LEFT,
    title: 'Một gia đình đã rời buổi hẹn',
    body: `${leaverName} đã rời${latePart} buổi "${activity || 'hẹn chơi'}".${reasonPart} Bạn có thể mời thêm bạn bè khác.`,
    data: { senderId: leaverParentId, playdateId },
  });
};

// Playdate cancelled -> notify every family still invited or joined (and the host when an admin cancelled it)
const notifyPlaydateCancelled = async ({
  playdateId,
  hostParentId,
  participantParentIds = [],
  activity,
  cancelledByAdmin,
  reason,
}) => {
  const recipientParentIds = [...participantParentIds];
  if (cancelledByAdmin && hostParentId) recipientParentIds.push(hostParentId);
  if (!recipientParentIds.length) return;

  const host = cancelledByAdmin ? null : await parentService.getParentById(hostParentId);
  const actorName = cancelledByAdmin ? 'Quản trị viên' : host?.fullName || DEFAULT_PARENT_NAME;
  // An admin's reason may quote a report: only the host's own words are shown
  const reasonPart = !cancelledByAdmin && reason ? ` Lý do: "${reason}".` : '';

  const results = await Promise.allSettled(
    [...new Set(recipientParentIds.map(String))].map(async (parentId) => {
      const parent = await parentService.getParentById(parentId);
      if (!parent?.userId) return;
      await notificationService.createNotification({
        recipientId: parent.userId,
        type: NOTIFICATION_TYPES.PLAYDATE_CANCELLED,
        title: 'Buổi hẹn chơi đã bị huỷ',
        body: `${actorName} đã huỷ buổi "${activity || 'hẹn chơi'}".${reasonPart}`,
        data: { senderId: cancelledByAdmin ? null : hostParentId, playdateId },
      });
    })
  );
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) =>
      logger.error(`[NotificationListeners] Playdate cancelled notification failed: ${result.reason?.message}`)
    );
};

// A playdate rated 4-5 stars -> a ready plan to meet the same friends again (BUD-49 D4), opened from the notification
const notifyRebookingSuggestion = async ({ playdateId, raterParentId, rating }) => {
  if (!rating || rating < REBOOKING_MIN_RATING) return;
  const parent = await parentService.getParentById(raterParentId);
  if (!parent?.userId) return;

  const prepared = await aiAssistantService.prepareRebookingSession({ parentId: raterParentId, playdateId });
  if (!prepared) return;

  const streak = parent.streak?.currentWeeklyStreak || 0;
  const streakText = streak > 0 ? ` Hẹn thêm một buổi trong tuần tới để giữ chuỗi ${streak} tuần nhé!` : '';
  await notificationService.createNotification({
    recipientId: parent.userId,
    type: NOTIFICATION_TYPES.AI_SUGGESTION,
    title: `Hẹn lại với ${prepared.childNames.join(', ')} nhé?`,
    body: `Buổi hẹn chơi vừa qua thật tuyệt! BuddyLink AI đã chuẩn bị sẵn kế hoạch buổi tiếp theo, bạn chỉ cần chọn thời gian.${streakText}`,
    data: { playdateId, sessionId: prepared.sessionId },
  });
};

let isRegistered = false;

/**
 * Register cross-module domain event listeners that create notifications.
 * Other modules are reached through their services, never their repositories (BACKEND_AI_GUIDE).
 */
export const registerNotificationListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  onConnectionEvent(CONNECTION_EVENTS.REQUESTED, (payload) =>
    runInBackground('Connection requested notification', () => notifyConnectionRequested(payload))
  );
  onConnectionEvent(CONNECTION_EVENTS.ACCEPTED, (payload) =>
    runInBackground('Connection accepted notification', () => notifyConnectionAccepted(payload))
  );
  onPlaydateEvent(PLAYDATE_EVENTS.INVITED, (payload) =>
    runInBackground('Playdate invited notification', () => notifyPlaydateInvited(payload))
  );
  onPlaydateEvent(PLAYDATE_EVENTS.PARTICIPANT_LEFT, (payload) =>
    runInBackground('Playdate participant left notification', () => notifyPlaydateParticipantLeft(payload))
  );
  onPlaydateEvent(PLAYDATE_EVENTS.CANCELLED, (payload) =>
    runInBackground('Playdate cancelled notification', () => notifyPlaydateCancelled(payload))
  );
  onPlaydateEvent(PLAYDATE_EVENTS.REMINDER_DUE, (payload) =>
    runInBackground('Playdate reminder notification', () => notifyPlaydateReminder(payload))
  );
  onRatingEvent(RATING_EVENTS.CREATED, (payload) =>
    runInBackground('Playdate rating created rebooking notification', () => notifyRebookingSuggestion(payload))
  );
};

export default registerNotificationListeners;
