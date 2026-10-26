import { param, query, body } from 'express-validator';
import { PLAYDATE_STATUS } from '../playdate/playdate.constants.js';
import { CONNECTION_STATUS } from '../connection/connection.constants.js';

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
    .trim()
    .isString(),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid fromDate (must be ISO8601 date string)'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid toDate (must be ISO8601 date string)'),
];

export const adminCancelPlaydateValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Cancellation reason is required')
    .isString()
    .withMessage('Cancellation reason must be a string'),
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
    .trim()
    .isString(),
];

export const adminDeleteConnectionValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid connection ID'),
  body('reason')
    .optional()
    .trim()
    .isString()
    .withMessage('Removal reason must be a string'),
];
