import { query, param, body } from 'express-validator';
import { CHILD_GENDERS } from '../child/child.constants.js';
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_FILTER_ALL,
  ADMIN_NOTIFICATION_SEVERITY,
  ADMIN_REASON_MAX_LENGTH,
  ADMIN_SEARCH_MAX_LENGTH,
  ANALYTICS_GROUP_BY,
  ANALYTICS_MAX_RANGE_DAYS,
} from './admin.constants.js';
import { PLAYDATE_STATUS } from '../playdate/playdate.constants.js';
import { CONNECTION_STATUS } from '../connection/connection.constants.js';
import {
  SUBSCRIPTION_PLAN_CODES,
  SUBSCRIPTION_STATUS,
  PAYMENT_STATUS,
  SUBSCRIPTION_PLAN_DEFAULTS,
} from '../subscription/subscription.constants.js';
import {
  REPORT_STATUS,
  REPORT_SEVERITY,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  REPORT_SANCTION_TYPES,
  REPORT_ACTION_TYPES,
  REPORT_RESOLUTION_TYPES,
  REPORT_SORTS,
} from '../safety/safety.constants.js';

const MONGO_ID_PATTERN = /^[a-f\d]{24}$/i;

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

// Limits of a plan (`features` of subscription_plans), -1 = unlimited
const PLAN_FEATURE_KEYS = Object.keys(SUBSCRIPTION_PLAN_DEFAULTS[0].features);

const pagingValidation = [
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

const dateRangeValidation = [
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO8601 date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO8601 date'),
];

const planCodeQueryValidation = query('planCode')
  .optional()
  .isIn(Object.values(SUBSCRIPTION_PLAN_CODES))
  .withMessage('Invalid plan code');

/**
 * Validation rules for PATCH /api/v1/admin/plans/:id
 */
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
    .withMessage('Price must be an integer >= 0')
    .toInt(),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
    .toBoolean(),
  body('features')
    .optional()
    .isObject()
    .withMessage('features must be an object'),
  ...PLAN_FEATURE_KEYS.map((key) =>
    body(`features.${key}`)
      .optional()
      .isInt({ min: -1 })
      .withMessage(`${key} must be >= -1`)
      .toInt()
  ),
];

/**
 * Validation rules for GET /api/v1/admin/subscriptions
 */
export const listSubscriptionsValidation = [
  ...pagingValidation,
  planCodeQueryValidation,
  query('status')
    .optional()
    .isIn(Object.values(SUBSCRIPTION_STATUS))
    .withMessage('Invalid subscription status'),
];

/**
 * Validation rules for GET /api/v1/admin/transactions
 */
export const listTransactionsValidation = [
  ...pagingValidation,
  ...dateRangeValidation,
  planCodeQueryValidation,
  query('status')
    .optional()
    .isIn(Object.values(PAYMENT_STATUS))
    .withMessage('Invalid payment status'),
];

/**
 * Validation rules for GET /api/v1/admin/revenue/summary
 */
export const revenueSummaryValidation = [...dateRangeValidation];

/**
 * Validation rules for GET /api/v1/admin/reports
 */
export const listReportsValidation = [
  ...pagingValidation,
  ...dateRangeValidation,
  query('status')
    .optional()
    .isIn(Object.values(REPORT_STATUS))
    .withMessage(`Status must be one of: ${Object.values(REPORT_STATUS).join(', ')}`),
  query('severity')
    .optional()
    .isIn(Object.values(REPORT_SEVERITY))
    .withMessage(`Severity must be one of: ${Object.values(REPORT_SEVERITY).join(', ')}`),
  query('category')
    .optional()
    .isIn(Object.values(REPORT_CATEGORIES))
    .withMessage(`Category must be one of: ${Object.values(REPORT_CATEGORIES).join(', ')}`),
  query('targetType')
    .optional()
    .isIn(Object.values(REPORT_TARGET_TYPES))
    .withMessage(`Target type must be one of: ${Object.values(REPORT_TARGET_TYPES).join(', ')}`),
  query('assignedTo')
    .optional()
    .custom((value) => value === 'me' || MONGO_ID_PATTERN.test(String(value)))
    .withMessage("assignedTo must be 'me' or a valid admin ID"),
  query('isOverdue')
    .optional()
    .isBoolean()
    .withMessage('isOverdue must be a boolean'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: ADMIN_SEARCH_MAX_LENGTH })
    .withMessage(`Search must be at most ${ADMIN_SEARCH_MAX_LENGTH} characters`),
  query('sort')
    .optional()
    .isIn(Object.values(REPORT_SORTS))
    .withMessage(`Sort must be one of: ${Object.values(REPORT_SORTS).join(', ')}`),
];

/**
 * Validation rules for GET /api/v1/admin/reports/stats
 */
export const reportStatsValidation = [...dateRangeValidation];

/**
 * Validation rules for :id param on report endpoints
 */
export const reportIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),
];

/**
 * Validation rules for PATCH /api/v1/admin/reports/:id/review
 */
export const reviewReportValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),
  body('action')
    .notEmpty()
    .withMessage('Action is required')
    .isIn(['claim', 'takeover'])
    .withMessage("Action must be either 'claim' or 'takeover'"),
];

/**
 * Validation rules for PATCH /api/v1/admin/reports/:id/severity
 */
export const updateReportSeverityValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),
  body('severity')
    .notEmpty()
    .withMessage('Severity is required')
    .isIn(Object.values(REPORT_SEVERITY))
    .withMessage(`Severity must be one of: ${Object.values(REPORT_SEVERITY).join(', ')}`),
  body('note')
    .optional()
    .isString()
    .trim(),
];

/**
 * Validation rules for POST /api/v1/admin/reports/:id/action
 */
export const applyReportActionValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),
  body('type')
    .notEmpty()
    .withMessage('Action type is required')
    .isIn(REPORT_SANCTION_TYPES)
    .withMessage(`Action type must be one of: ${REPORT_SANCTION_TYPES.join(', ')}`),
  body('durationDays')
    .optional({ nullable: true })
    .isInt({ min: 1, max: 365 })
    .withMessage('Duration days must be an integer between 1 and 365')
    .bail()
    .custom((val, { req }) => {
      if (req.body.type === REPORT_ACTION_TYPES.SUSPEND && !val) {
        throw new Error('durationDays is required when action type is suspend');
      }
      return true;
    }),
  body('note')
    .optional()
    .isString()
    .trim(),
];

/**
 * Validation rules for PATCH /api/v1/admin/reports/:id/resolve
 */
export const resolveReportValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn([REPORT_STATUS.RESOLVED, REPORT_STATUS.DISMISSED])
    .withMessage(`Status must be either '${REPORT_STATUS.RESOLVED}' or '${REPORT_STATUS.DISMISSED}'`),
  body('resolution')
    .notEmpty()
    .withMessage('Resolution is required')
    .isIn(Object.values(REPORT_RESOLUTION_TYPES))
    .withMessage(`Resolution must be one of: ${Object.values(REPORT_RESOLUTION_TYPES).join(', ')}`)
    .bail()
    .custom((value, { req }) => {
      const isDismissal = req.body.status === REPORT_STATUS.DISMISSED;
      if (isDismissal !== (value === REPORT_RESOLUTION_TYPES.DISMISSED)) {
        throw new Error('A dismissed report needs the dismissed resolution, and only a dismissed report can have it');
      }
      return true;
    }),
  body('adminNotes')
    .notEmpty()
    .withMessage('Admin notes are required')
    .isString()
    .custom((val) => {
      if (typeof val !== 'string' || val.trim().length < 10) {
        throw new Error('adminNotes must be at least 10 characters after trim');
      }
      return true;
    }),
  body('applyToRelatedReportIds')
    .optional()
    .isArray()
    .withMessage('applyToRelatedReportIds must be an array of IDs'),
  body('applyToRelatedReportIds.*')
    .optional()
    .isMongoId()
    .withMessage('Each related report ID must be a valid Mongo ID'),
];

/**
 * Validation rules for PATCH /api/v1/admin/reports/:id/reopen
 */
export const reopenReportValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid report ID'),
  body('note')
    .notEmpty()
    .withMessage('Note is required')
    .isString()
    .custom((val) => {
      if (typeof val !== 'string' || val.trim().length < 10) {
        throw new Error('note must be at least 10 characters after trim');
      }
      return true;
    }),
];

/**
 * Validation rules for GET /api/v1/admin/analytics
 */
export const adminAnalyticsValidation = [
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO8601 date')
    .bail()
    .custom((value, { req }) => {
      // Without toDate the range ends today, so a lone fromDate is checked too
      const start = new Date(value);
      const end = req.query.toDate ? new Date(req.query.toDate) : new Date();
      if (start > end) {
        throw new Error('fromDate must be on or before toDate');
      }
      if (end.getTime() - start.getTime() > ANALYTICS_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
        throw new Error('Date range cannot exceed 12 months');
      }
      return true;
    }),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO8601 date'),
  query('groupBy')
    .optional()
    .isIn(Object.values(ANALYTICS_GROUP_BY))
    .withMessage('groupBy must be one of: day, week, month'),
];

const notificationCategoryValidation = query('category')
  .optional()
  .isIn([...Object.values(ADMIN_NOTIFICATION_CATEGORIES), ADMIN_NOTIFICATION_FILTER_ALL])
  .withMessage('Invalid notification category');

/**
 * Validation rules for GET /api/v1/admin/notifications
 */
export const listAdminNotificationsValidation = [
  notificationCategoryValidation,
  query('severity')
    .optional()
    .isIn([...Object.values(ADMIN_NOTIFICATION_SEVERITY), ADMIN_NOTIFICATION_FILTER_ALL])
    .withMessage('Invalid notification severity'),
  query('isRead')
    .optional()
    .isBoolean()
    .withMessage('isRead must be a boolean'),
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
 * Validation rules for PATCH /api/v1/admin/notifications/read-all
 */
export const readAllAdminNotificationsValidation = [notificationCategoryValidation];
