import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';
import { getIO } from '../../config/socket.js';
import NotificationDTO from './notification.dto.js';
import { NOTIFICATION_TYPES, NOTIFICATION_SOCKET_EVENTS } from './notification.constants.js';
import notificationRepository from './notification.repository.js';
import parentRepository from '../parent/parent.repository.js';
import playdateRepository from '../playdate/playdate.repository.js';
import { onConnectionEvent, CONNECTION_EVENTS } from '../connection/connection.events.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';

export const NOTIFICATION_EVENTS = Object.freeze({
  CREATED: 'notification.created',
  READ: 'notification.read',
  READ_ALL: 'notification.readAll',
});

const emitter = new EventEmitter();

/**
 * Subscribe to a notification event
 * @param {string} event
 * @param {(payload: Object) => Promise<void>|void} handler
 */
export const onNotificationEvent = (event, handler) => {
  emitter.on(event, handler);
};

/**
 * Emit a notification domain event and execute listeners safely
 * @param {string} event
 * @param {Object} payload
 */
export const emitNotificationEvent = async (event, payload) => {
  const results = await Promise.allSettled(emitter.listeners(event).map((handler) => handler(payload)));
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => logger.error(`[NotificationEvents] ${event} handler failed: ${result.reason?.message}`));
};

let isRegistered = false;

/**
 * Register notification event listeners (realtime socket broadcasts & cross-module subscriptions)
 */
export const registerNotificationEventListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  // 1. When a notification is created, push via socket to the recipient's personal user room
  onNotificationEvent(NOTIFICATION_EVENTS.CREATED, async ({ notification, unreadCount }) => {
    try {
      const io = getIO();
      if (!io || !notification?.recipientId) return;

      const recipientUserId = notification.recipientId?._id?.toString() || notification.recipientId?.toString();
      const notificationDto = NotificationDTO.toResponse(notification);

      io.to(`user:${recipientUserId}`).emit(NOTIFICATION_SOCKET_EVENTS.NEW_NOTIFICATION, notificationDto);
      io.to(`user:${recipientUserId}`).emit(NOTIFICATION_SOCKET_EVENTS.UNREAD_COUNT, { unreadCount });
    } catch (err) {
      logger.error(`[NotificationEvents] Socket emit failed for new notification: ${err.message}`);
    }
  });

  // 2. When a single notification is marked as read, push updated unread count and read state
  onNotificationEvent(NOTIFICATION_EVENTS.READ, async ({ recipientId, notificationId, unreadCount }) => {
    try {
      const io = getIO();
      if (!io || !recipientId) return;

      io.to(`user:${recipientId}`).emit(NOTIFICATION_SOCKET_EVENTS.READ, { notificationId, unreadCount });
      io.to(`user:${recipientId}`).emit(NOTIFICATION_SOCKET_EVENTS.UNREAD_COUNT, { unreadCount });
    } catch (err) {
      logger.error(`[NotificationEvents] Socket emit failed for notification read: ${err.message}`);
    }
  });

  // 3. When all notifications are marked as read, push read all and reset unread count
  onNotificationEvent(NOTIFICATION_EVENTS.READ_ALL, async ({ recipientId }) => {
    try {
      const io = getIO();
      if (!io || !recipientId) return;

      io.to(`user:${recipientId}`).emit(NOTIFICATION_SOCKET_EVENTS.READ_ALL, { unreadCount: 0 });
      io.to(`user:${recipientId}`).emit(NOTIFICATION_SOCKET_EVENTS.UNREAD_COUNT, { unreadCount: 0 });
    } catch (err) {
      logger.error(`[NotificationEvents] Socket emit failed for notification read-all: ${err.message}`);
    }
  });

  // 4. Cross-module: Connection Request sent -> notify the recipient parent
  onConnectionEvent(CONNECTION_EVENTS.REQUESTED, async ({ requesterParentId, recipientParentId, connectionId }) => {
    try {
      const [requester, recipient] = await Promise.all([
        parentRepository.findById(requesterParentId),
        parentRepository.findById(recipientParentId),
      ]);

      if (!recipient?.userId) return;

      const requesterName = requester?.fullName || 'Một phụ huynh';
      const notification = await notificationRepository.create({
        recipientId: recipient.userId,
        type: NOTIFICATION_TYPES.CONNECTION_REQUEST,
        title: 'Lời mời kết nối mới',
        body: `${requesterName} đã gửi lời mời kết nối đến bạn.`,
        data: {
          senderId: requesterParentId,
          connectionId,
        },
      });

      const populated = await notificationRepository.findById(notification._id);
      const unreadCount = await notificationRepository.countUnread(recipient.userId);

      await emitNotificationEvent(NOTIFICATION_EVENTS.CREATED, {
        notification: populated || notification,
        unreadCount,
      });
    } catch (err) {
      logger.error(`[NotificationEvents] Connection requested notification failed: ${err.message}`);
    }
  });

  // 5. Cross-module: Connection Request accepted -> notify the requester parent
  onConnectionEvent(CONNECTION_EVENTS.ACCEPTED, async ({ requesterId, recipientId, connectionId }) => {
    try {
      if (!requesterId || !recipientId) return;

      const [requester, recipient] = await Promise.all([
        parentRepository.findById(requesterId),
        parentRepository.findById(recipientId),
      ]);

      if (!requester?.userId) return;

      const recipientName = recipient?.fullName || 'Một phụ huynh';
      const notification = await notificationRepository.create({
        recipientId: requester.userId,
        type: NOTIFICATION_TYPES.CONNECTION_ACCEPTED,
        title: 'Lời mời kết nối đã được chấp nhận',
        body: `${recipientName} đã đồng ý kết nối với bạn. Giờ hai bạn đã có thể trò chuyện!`,
        data: {
          senderId: recipientId,
          connectionId,
        },
      });

      const populated = await notificationRepository.findById(notification._id);
      const unreadCount = await notificationRepository.countUnread(requester.userId);

      await emitNotificationEvent(NOTIFICATION_EVENTS.CREATED, {
        notification: populated || notification,
        unreadCount,
      });
    } catch (err) {
      logger.error(`[NotificationEvents] Connection accepted notification failed: ${err.message}`);
    }
  });

  // 6. Cross-module: Playdate Invitation sent -> notify invited participant parents
  onPlaydateEvent(PLAYDATE_EVENTS.INVITED, async ({ playdateId, hostParentId, participantParentIds = [] }) => {
    try {
      const [host, playdate] = await Promise.all([
        parentRepository.findById(hostParentId),
        playdateRepository.findById(playdateId),
      ]);

      const hostName = host?.fullName || 'Một phụ huynh';
      const activity = playdate?.activity || 'buổi hẹn chơi';

      for (const pId of participantParentIds) {
        try {
          const participant = await parentRepository.findById(pId);
          if (!participant?.userId) continue;

          const notification = await notificationRepository.create({
            recipientId: participant.userId,
            type: NOTIFICATION_TYPES.PLAYDATE_INVITE,
            title: 'Lời mời tham gia Playdate',
            body: `${hostName} đã mời bạn và bé tham gia "${activity}".`,
            data: {
              senderId: hostParentId,
              playdateId,
            },
          });

          const populated = await notificationRepository.findById(notification._id);
          const unreadCount = await notificationRepository.countUnread(participant.userId);

          await emitNotificationEvent(NOTIFICATION_EVENTS.CREATED, {
            notification: populated || notification,
            unreadCount,
          });
        } catch (subErr) {
          logger.error(`[NotificationEvents] Playdate invite notification failed for parent ${pId}: ${subErr.message}`);
        }
      }
    } catch (err) {
      logger.error(`[NotificationEvents] Playdate invited notification handler failed: ${err.message}`);
    }
  });
};

export default registerNotificationEventListeners;
