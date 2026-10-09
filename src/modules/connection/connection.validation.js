import { body, param, query } from 'express-validator';

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
    .isIn(['pending', 'accepted', 'declined', 'removed'])
    .withMessage('Invalid status value'),
];
