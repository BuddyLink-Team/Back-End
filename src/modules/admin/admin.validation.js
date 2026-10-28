import { query, param, body } from 'express-validator';
import { CHILD_GENDERS } from '../child/child.constants.js';
import { ADMIN_SEARCH_MAX_LENGTH, ADMIN_REASON_MAX_LENGTH } from './admin.constants.js';
import { PLAYDATE_STATUS } from '../playdate/playdate.constants.js';
import { CONNECTION_STATUS } from '../connection/connection.constants.js';

/**
 * Validation rules for GET /api/v1/admin/users
 */
export const listUsersValidation = [
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: ADMIN_SEARCH_MAX_LENGTH })
    .withMessage(`Search must be at most ${ADMIN_SEARCH_MAX_LENGTH} characters`),
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  query('isVerified')
    .optional()
    .isBoolean()
    .withMessage('isVerified must be a boolean'),
  query('isPremium')
    .optional()
    .isBoolean()
    .withMessage('isPremium must be a boolean'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

/**
 * Validation rules for :id param on user endpoints
 */
export const userIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid user ID'),
];

/**
 * Validation rules for PATCH /api/v1/admin/users/:id/status
 */
export const updateUserStatusValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid user ID'),
  body('isActive')
    .notEmpty()
    .withMessage('isActive is required')
    .isBoolean()
    .withMessage('isActive must be a boolean'),
];

/**
 * Validation rules for GET /api/v1/admin/children
 */
export const listChildrenValidation = [
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: ADMIN_SEARCH_MAX_LENGTH })
    .withMessage(`Search must be at most ${ADMIN_SEARCH_MAX_LENGTH} characters`),
  query('gender')
    .optional()
    .isIn(Object.values(CHILD_GENDERS))
    .withMessage(`Gender must be one of: ${Object.values(CHILD_GENDERS).join(', ')}`),
  query('minAge')
    .optional()
    .isInt({ min: 0, max: 18 })
    .withMessage('minAge must be between 0 and 18'),
  query('maxAge')
    .optional()
    .isInt({ min: 0, max: 18 })
    .withMessage('maxAge must be between 0 and 18')
    .bail()
    .custom((value, { req }) =>
      req.query.minAge === undefined || parseInt(req.query.minAge, 10) <= parseInt(value, 10)
    )
    .withMessage('maxAge must be greater than or equal to minAge'),
  query('isArchived')
    .optional()
    .isBoolean()
    .withMessage('isArchived must be a boolean'),
  query('isPlanLocked')
    .optional()
    .isBoolean()
    .withMessage('isPlanLocked must be a boolean'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

/**
 * Validation rules for :id param on child endpoints
 */
export const childIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid child ID'),
];

/**
 * Validation rules for GET /api/v1/admin/payments
 */
export const listPaymentsValidation = [
  query('parentId')
    .notEmpty()
    .withMessage('parentId is required')
    .isMongoId()
    .withMessage('Invalid parent ID'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

export const mongoIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid ID'),
];

export const adminGetPlaydatesValidation = [
  query('status')
    .optional()
    .isIn([...Object.values(PLAYDATE_STATUS), 'all'])
    .withMessage('Invalid playdate status'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: ADMIN_SEARCH_MAX_LENGTH })
    .withMessage(`Search must be at most ${ADMIN_SEARCH_MAX_LENGTH} characters`),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid fromDate (must be ISO8601 date string)'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid toDate (must be ISO8601 date string)')
    .bail()
    .custom((value, { req }) => !req.query.fromDate || new Date(req.query.fromDate) <= new Date(value))
    .withMessage('toDate must be on or after fromDate'),
];

export const adminCancelPlaydateValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('reason')
    .isString()
    .withMessage('Cancellation reason must be a string')
    .trim()
    .notEmpty()
    .withMessage('Cancellation reason is required')
    .isLength({ max: ADMIN_REASON_MAX_LENGTH })
    .withMessage(`Cancellation reason must be at most ${ADMIN_REASON_MAX_LENGTH} characters`),
];

export const adminGetConnectionsValidation = [
  query('status')
    .optional()
    .isIn([...Object.values(CONNECTION_STATUS), 'all'])
    .withMessage('Invalid connection status'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: ADMIN_SEARCH_MAX_LENGTH })
    .withMessage(`Search must be at most ${ADMIN_SEARCH_MAX_LENGTH} characters`),
];

export const adminDeleteConnectionValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid connection ID'),
  body('reason')
    .optional()
    .isString()
    .withMessage('Removal reason must be a string')
    .trim()
    .isLength({ max: ADMIN_REASON_MAX_LENGTH })
    .withMessage(`Removal reason must be at most ${ADMIN_REASON_MAX_LENGTH} characters`),
];
