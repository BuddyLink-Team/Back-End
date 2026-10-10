import { body, param, query } from 'express-validator';
import { CONNECTION_STATUS } from './connection.constants.js';

export const requestConnectionValidation = [
  body('recipientId')
    .isMongoId()
    .withMessage('Invalid recipient ID format'),
];

export const connectionIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid connection ID format'),
];

export const getConnectionsValidation = [
  query('status')
    .optional()
    .isIn(Object.values(CONNECTION_STATUS))
    .withMessage('Invalid status value'),
  query('direction')
    .optional()
    .isIn(['incoming', 'outgoing'])
    .withMessage('direction must be incoming or outgoing'),
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('search must be at most 100 characters'),
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];
