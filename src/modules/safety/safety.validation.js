import { body } from 'express-validator';
import { REPORT_TARGET_TYPES, REPORT_LIMITS } from './safety.constants.js';

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
  body('reason')
    .isString()
    .withMessage('reason must be a string')
    .trim()
    .notEmpty()
    .withMessage('reason is required')
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
