import notificationRepository from './notification.repository.js';
import { NOTIFICATION_STREAM_RETRY_MS, NOTIFICATION_TYPES } from './notification.constants.js';
import { emitNotificationEvent, NOTIFICATION_EVENTS } from './notification.events.js';
import AppError from '../../shared/exceptions/app-error.js';
import logger from '../../shared/logger/index.js';
import { supportsChangeStreams } from '../../shared/helpers/transaction.helper.js';
import NotificationDTO from './notification.dto.js';

class NotificationService {
  constructor() {
    this.stream = null;
    this.retryTimer = null;
  }

  /**
   * Create an in-app notification. The recipient gets it from the change stream when one is open
   * (see startRealtimeBroadcast); without one (standalone MongoDB, one process) it is sent right away.
   * @param {Object} notificationData
   * @returns {Promise<Object>}
   */
  async createNotification(notificationData) {
    const notification = await notificationRepository.create(notificationData);
    const populated = await notificationRepository.findById(notification._id);

    if (!this.stream) await this._emitCreated(populated || notification);

    return populated || notification;
  }

  /**
   * Send notifications to the recipients as soon as they are saved, whichever process saved them:
   * in production the admin API creates some of them and only the parent API has the parent sockets.
   * Only the parent API calls it. Change streams need a replica set: on a standalone MongoDB
   * createNotification sends them instead.
   */
  startRealtimeBroadcast() {
    if (!supportsChangeStreams()) {
      logger.info('[Notifications] No change streams on this MongoDB, notifications are sent directly');
      return;
    }
    this._openStream();
  }

  /**
   * Close the change stream (shutdown and tests)
   */
  async stopRealtimeBroadcast() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const stream = this.stream;
    this.stream = null;
    if (stream) await stream.close();
  }

  _openStream() {
    const stream = notificationRepository.watchInserts();
    this.stream = stream;

    stream.on('change', ({ fullDocument }) => {
      void this._broadcastSaved(fullDocument);
    });

    stream.on('error', (err) => {
      logger.error(`[Notifications] Change stream failed: ${err.message}`);
      this.stream = null;
      stream.close().catch(() => {});
      // Parents reload the list when they reconnect; until the retry, notifications are sent directly
      this.retryTimer = setTimeout(() => this._openStream(), NOTIFICATION_STREAM_RETRY_MS);
      this.retryTimer.unref?.();
    });
  }

  async _broadcastSaved(saved) {
    try {
      await this._emitCreated((await notificationRepository.findById(saved._id)) || saved);
    } catch (err) {
      logger.error(`[Notifications] Broadcast failed: ${err.message}`);
    }
  }

  async _emitCreated(notification) {
    const unreadCount = await notificationRepository.countUnread(notification.recipientId);
    await emitNotificationEvent(NOTIFICATION_EVENTS.CREATED, { notification, unreadCount });
  }

  /**
   * Notify a user that a badge was unlocked
   * @param {string|ObjectId} recipientUserId - users._id
   * @param {{ code: string, title: string, description: string }} badge
   * @returns {Promise<Object>}
   */
  async notifyBadgeUnlocked(recipientUserId, badge) {
    return this.createNotification({
      recipientId: recipientUserId,
      type: NOTIFICATION_TYPES.BADGE_UNLOCKED,
      title: 'Bạn vừa mở khóa huy hiệu mới!',
      body: `Huy hiệu "${badge.title}": ${badge.description}`,
      data: { badgeCode: badge.code },
    });
  }

  /**
   * Get paginated notifications for the authenticated user
   * @param {string|ObjectId} userId
   * @param {Object} options
   * @returns {Promise<{ items: Array<Object>, unreadCount: number, pagination: Object }>}
   */
  async getUserNotifications(userId, { page = 1, limit = 10, type, isRead } = {}) {
    let parsedIsRead;
    if (isRead === 'true' || isRead === true) parsedIsRead = true;
    else if (isRead === 'false' || isRead === false) parsedIsRead = false;

    const [paginated, unreadCount] = await Promise.all([
      notificationRepository.findUserNotifications(userId, {
        page,
        limit,
        type,
        isRead: parsedIsRead,
      }),
      notificationRepository.countUnread(userId),
    ]);

    return {
      items: NotificationDTO.toResponseList(paginated.items),
      unreadCount,
      pagination: {
        page: paginated.page,
        limit: paginated.limit,
        total: paginated.total,
        totalPages: paginated.totalPages,
      },
    };
  }

  /**
   * Get total unread notifications count for the authenticated user
   * @param {string|ObjectId} userId
   * @returns {Promise<{ unreadCount: number }>}
   */
  async getUnreadCount(userId) {
    const unreadCount = await notificationRepository.countUnread(userId);
    return { unreadCount };
  }

  /**
   * Mark a single notification as read
   * @param {string|ObjectId} notificationId
   * @param {string|ObjectId} userId
   * @returns {Promise<{ notification: Object, unreadCount: number }>}
   */
  async markNotificationAsRead(notificationId, userId) {
    const existing = await notificationRepository.findById(notificationId);
    if (!existing || existing.recipientId?.toString() !== userId.toString()) {
      throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
    }

    if (existing.isRead) {
      const unreadCount = await notificationRepository.countUnread(userId);
      return {
        notification: NotificationDTO.toResponse(existing),
        unreadCount,
      };
    }

    const updated = await notificationRepository.markAsRead(notificationId, userId);
    const unreadCount = await notificationRepository.countUnread(userId);

    await emitNotificationEvent(NOTIFICATION_EVENTS.READ, {
      recipientId: userId.toString(),
      notificationId: notificationId.toString(),
      unreadCount,
    });

    return {
      notification: NotificationDTO.toResponse(updated || existing),
      unreadCount,
    };
  }

  /**
   * Mark all notifications of the user as read
   * @param {string|ObjectId} userId
   * @returns {Promise<{ updatedCount: number, unreadCount: number }>}
   */
  async markAllAsRead(userId) {
    const { modifiedCount } = await notificationRepository.markAllAsRead(userId);

    if (modifiedCount > 0) {
      await emitNotificationEvent(NOTIFICATION_EVENTS.READ_ALL, {
        recipientId: userId.toString(),
      });
    }

    return {
      updatedCount: modifiedCount,
      unreadCount: 0,
    };
  }
}

export const notificationService = new NotificationService();
export default notificationService;
