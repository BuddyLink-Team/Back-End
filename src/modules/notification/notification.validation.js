import { param, query } from 'express-validator';
import { NOTIFICATION_TYPES } from './notification.constants.js';

export const notificationIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid notification ID format'),
];

export const getNotificationsValidation = [
  query('type')
    .optional()
    .isIn(Object.values(NOTIFICATION_TYPES))
    .withMessage('Invalid notification type'),
  query('isRead')
    .optional()
    .isIn(['true', 'false', true, false])
    .withMessage('isRead must be true or false'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
];
