import { body, param, query } from 'express-validator';
import { REPORT_TARGET_TYPES, REPORT_LIMITS, REPORT_CATEGORIES } from './safety.constants.js';

export const blockUserValidation = [
  body('blockedId')
    .optional()
    .isMongoId()
    .withMessage('blockedId must be a valid MongoDB ObjectId'),
  body('targetParentId')
    .optional()
    .isMongoId()
    .withMessage('targetParentId must be a valid MongoDB ObjectId'),
  body().custom((value) => {
    if (!value?.blockedId && !value?.targetParentId) {
      throw new Error('blockedId is required');
    }
    return true;
  }),
  body('reason')
    .optional()
    .isString()
    .withMessage('reason must be a string')
    .trim()
    .isLength({ max: 500 })
    .withMessage('reason cannot exceed 500 characters'),
];

export const createReportValidation = [
  body('reportedUserId')
    .notEmpty()
    .withMessage('reportedUserId is required')
    .isMongoId()
    .withMessage('reportedUserId must be a valid MongoDB ObjectId'),
  body('targetType')
    .optional()
    .isIn(Object.values(REPORT_TARGET_TYPES))
    .withMessage(`targetType must be one of: ${Object.values(REPORT_TARGET_TYPES).join(', ')}`),
  body('targetMessageId')
    .optional({ values: 'null' })
    .isMongoId()
    .withMessage('targetMessageId must be a valid MongoDB ObjectId'),
  body('targetPlaydateId')
    .optional({ values: 'null' })
    .isMongoId()
    .withMessage('targetPlaydateId must be a valid MongoDB ObjectId'),
  body('category')
    .notEmpty()
    .withMessage('category is required')
    .isIn(Object.values(REPORT_CATEGORIES))
    .withMessage(`category must be one of: ${Object.values(REPORT_CATEGORIES).join(', ')}`),
  body('reason')
    .optional()
    .isString()
    .withMessage('reason must be a string')
    .trim()
    .isLength({ max: 200 })
    .withMessage('reason cannot exceed 200 characters'),
  body('description')
    .optional()
    .isString()
    .withMessage('description must be a string')
    .trim()
    .isLength({ max: 1000 })
    .withMessage('description cannot exceed 1000 characters'),
  // Ownership of each URL (uploaded through our Cloud Storage) is checked in safetyService
  body('evidenceUrls')
    .optional()
    .isArray({ max: REPORT_LIMITS.MAX_EVIDENCE_URLS })
    .withMessage(`evidenceUrls must be an array of at most ${REPORT_LIMITS.MAX_EVIDENCE_URLS} items`),
  body('evidenceUrls.*')
    .isString()
    .withMessage('evidenceUrls items must be strings'),
];

export const unblockUserValidation = [
  param('id')
    .isMongoId()
    .withMessage('id must be a valid MongoDB ObjectId'),
];

export const getBlockedUsersValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be an integer greater than 0'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('search cannot exceed 100 characters'),
];
