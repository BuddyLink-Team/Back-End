import notificationService from './notification.service.js';
import { successResponse } from '../../shared/response/index.js';

class NotificationController {
  /**
   * GET /api/v1/notifications
   * Query params: page, limit, type, isRead
   */
  async getNotifications(req, res, next) {
    try {
      const { page, limit, type, types, isRead } = req.query;
      const data = await notificationService.getUserNotifications(req.userId, {
        page,
        limit,
        type: type || types,
        isRead,
      });

      return successResponse(res, data, 'Notifications retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/notifications/unread-count
   */
  async getUnreadCount(req, res, next) {
    try {
      const data = await notificationService.getUnreadCount(req.userId);
      return successResponse(res, data, 'Unread count retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   */
  async markAsRead(req, res, next) {
    try {
      const data = await notificationService.markNotificationAsRead(req.params.id, req.userId);
      return successResponse(res, data, 'Notification marked as read', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/notifications/read-all
   */
  async markAllAsRead(req, res, next) {
    try {
      const data = await notificationService.markAllAsRead(req.userId);
      return successResponse(res, data, 'All notifications marked as read', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export const notificationController = new NotificationController();
export default notificationController;
