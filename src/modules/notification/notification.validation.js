import { param, query } from 'express-validator';
import { NOTIFICATION_TYPES } from './notification.constants.js';

export const notificationIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid notification ID format'),
];

export const getNotificationsValidation = [
  query(['type', 'types'])
    .optional()
    .custom((value) => {
      const types = Array.isArray(value)
        ? value
        : String(value).split(',').map((t) => t.trim()).filter(Boolean);
      const validTypes = Object.values(NOTIFICATION_TYPES);
      const allValid = types.length > 0 && types.every((t) => validTypes.includes(t));
      if (!allValid) {
        throw new Error('Invalid notification type');
      }
      return true;
    }),
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
