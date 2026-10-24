import { Router } from 'express';
import notificationController from './notification.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import {
  notificationIdParamValidation,
  getNotificationsValidation,
} from './notification.validation.js';

const router = Router();

// All notification endpoints require authenticated user
router.use(authenticate);

// Get paginated notifications list (?page=&limit=&type=&isRead=)
router.get('/', validate(getNotificationsValidation), notificationController.getNotifications);

// Get total unread count
router.get('/unread-count', notificationController.getUnreadCount);

// Mark all notifications as read
router.patch('/read-all', notificationController.markAllAsRead);

// Mark a specific notification as read
router.patch('/:id/read', validate(notificationIdParamValidation), notificationController.markAsRead);

export default router;
