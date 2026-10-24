import notificationRepository from './notification.repository.js';
import { NOTIFICATION_TYPES } from './notification.constants.js';
import { emitNotificationEvent, NOTIFICATION_EVENTS } from './notification.events.js';
import AppError from '../../shared/exceptions/AppError.js';
import NotificationDTO from './notification.dto.js';

class NotificationService {
  /**
   * Create an in-app notification and trigger realtime event
   * @param {Object} notificationData
   * @returns {Promise<Object>}
   */
  async createNotification(notificationData) {
    const notification = await notificationRepository.create(notificationData);
    const populated = await notificationRepository.findById(notification._id);
    const recipientId = notification.recipientId?._id || notification.recipientId;
    const unreadCount = await notificationRepository.countUnread(recipientId);

    await emitNotificationEvent(NOTIFICATION_EVENTS.CREATED, {
      notification: populated || notification,
      unreadCount,
    });

    return populated || notification;
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
