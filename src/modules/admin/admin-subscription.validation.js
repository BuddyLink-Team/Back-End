import { body, param, query } from 'express-validator';

export const updatePlanValidation = [
  param('id')
    .isMongoId()
    .withMessage('Valid plan ID is required'),
  body('name')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Name must not exceed 100 characters'),
  body('price')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Price must be an integer >= 0'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  body('features')
    .optional()
    .isObject()
    .withMessage('features must be an object'),
  body('features.childProfilesLimit')
    .optional()
    .isInt({ min: -1 })
    .withMessage('childProfilesLimit must be >= -1'),
  body('features.discoveryViewLimitPerDay')
    .optional()
    .isInt({ min: -1 })
    .withMessage('discoveryViewLimitPerDay must be >= -1'),
  body('features.connectionRequestsLimitPerMonth')
    .optional()
    .isInt({ min: -1 })
    .withMessage('connectionRequestsLimitPerMonth must be >= -1'),
  body('features.playdatesLimitPerMonth')
    .optional()
    .isInt({ min: -1 })
    .withMessage('playdatesLimitPerMonth must be >= -1'),
  body('features.playdateParticipationLimitPerMonth')
    .optional()
    .isInt({ min: -1 })
    .withMessage('playdateParticipationLimitPerMonth must be >= -1'),
  body('features.aiAssistantLimitPerMonth')
    .optional()
    .isInt({ min: -1 })
    .withMessage('aiAssistantLimitPerMonth must be >= -1'),
];

export const getSubscriptionsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('planCode')
    .optional()
    .isString()
    .trim(),
  query('status')
    .optional()
    .isIn(['active', 'expired'])
    .withMessage('Status must be active or expired'),
  query('search')
    .optional()
    .isString()
    .trim(),
];

export const getTransactionsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['creating', 'pending', 'success', 'failed', 'cancelled', 'expired'])
    .withMessage('Invalid payment status'),
  query('planCode')
    .optional()
    .isString()
    .trim(),
  query('parentId')
    .optional()
    .isMongoId()
    .withMessage('Invalid parentId format'),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO8601 date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO8601 date'),
  query('search')
    .optional()
    .isString()
    .trim(),
];

export const getTransactionDetailValidation = [
  param('id')
    .isMongoId()
    .withMessage('Valid payment ID is required'),
];

export const getRevenueSummaryValidation = [
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO8601 date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO8601 date'),
];
