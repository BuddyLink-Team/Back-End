import { body, param, query, header } from 'express-validator';
import { SUBSCRIPTION_PLAN_CODES } from './subscription.constants.js';

export const checkoutValidation = [
  header('idempotency-key')
    .trim()
    .notEmpty()
    .withMessage('Idempotency-Key header is required'),
  body('planCode')
    .trim()
    .notEmpty()
    .withMessage('planCode is required')
    .isIn([
      SUBSCRIPTION_PLAN_CODES.PREMIUM_MONTHLY,
      SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY,
    ])
    .withMessage('Invalid upgrade plan'),
];

export const verifyPaymentValidation = [
  param('orderCode')
    .trim()
    .notEmpty()
    .withMessage('orderCode is required')
    .isNumeric()
    .withMessage('orderCode must be numeric'),
];

export const historyQueryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be an integer >= 1'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('limit must be between 1 and 50'),
];
