import { EventEmitter } from 'node:events';
import logger from '../../shared/logger/index.js';
import { getIO } from '../../config/socket.js';
import NotificationDTO from './notification.dto.js';
import { NOTIFICATION_SOCKET_EVENTS } from './notification.constants.js';

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
 * Register notification event listeners (realtime socket broadcasts).
 * Cross-module triggers live in notification.listener.js, registered from app.js, so this file
 * never imports the service (the service imports this file).
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
};

export default registerNotificationEventListeners;
