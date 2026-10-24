import logger from '../../shared/logger/index.js';
import notificationService from './notification.service.js';
import { NOTIFICATION_TYPES } from './notification.constants.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import playdateService from '../playdate/playdate.service.js';
import { onConnectionEvent, CONNECTION_EVENTS } from '../connection/connection.events.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';

const DEFAULT_PARENT_NAME = 'Một phụ huynh';

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
const notifyPlaydateReminder = async ({ playdateId, kind, activity, time, date, placeName, recipientParentIds = [] }) => {
  const isSoon = kind === 'h1';
  const where = placeName ? ` tại ${placeName}` : '';
  const title = isSoon ? 'Playdate sắp bắt đầu' : 'Nhắc lịch Playdate';
  const body = isSoon
    ? `"${activity}" sẽ bắt đầu lúc ${time}${where}. Chuẩn bị lên đường nhé!`
    : `"${activity}" diễn ra lúc ${time} ngày ${date}${where}.`;

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
  onPlaydateEvent(PLAYDATE_EVENTS.REMINDER_DUE, (payload) =>
    runInBackground('Playdate reminder notification', () => notifyPlaydateReminder(payload))
  );
};

export default registerNotificationListeners;
