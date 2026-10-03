import { body, param, query } from 'express-validator';
import { MESSAGE_TYPES, CONVERSATION_TYPES } from './chat.constants.js';

export const createDirectConversationValidation = [
  body('targetParentId')
    .notEmpty()
    .withMessage('targetParentId is required')
    .isMongoId()
    .withMessage('targetParentId must be a valid MongoDB ObjectId'),
];

export const conversationIdParamValidation = [
  param('conversationId')
    .notEmpty()
    .withMessage('conversationId is required')
    .isMongoId()
    .withMessage('conversationId must be a valid MongoDB ObjectId'),
];

export const sendMessageValidation = [
  param('conversationId')
    .notEmpty()
    .withMessage('conversationId is required')
    .isMongoId()
    .withMessage('conversationId must be a valid MongoDB ObjectId'),
  body('content')
    .optional()
    .isString()
    .withMessage('content must be a string')
    .trim()
    .isLength({ max: 5000 })
    .withMessage('content cannot exceed 5000 characters'),
  body('type')
    .optional()
    .isIn([MESSAGE_TYPES.TEXT, MESSAGE_TYPES.IMAGE, MESSAGE_TYPES.EMOJI])
    .withMessage(`type must be one of: ${[MESSAGE_TYPES.TEXT, MESSAGE_TYPES.IMAGE, MESSAGE_TYPES.EMOJI].join(', ')}`),
  body('mediaUrl')
    .optional()
    .isString()
    .isLength({ max: 2048 })
    .withMessage('mediaUrl cannot exceed 2048 characters')
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('mediaUrl must be a valid HTTP or HTTPS URL'),
  body().custom((value) => {
    const hasContent = value.content && value.content.trim().length > 0;
    const hasMedia = value.mediaUrl && value.mediaUrl.trim().length > 0;
    if (!hasContent && !hasMedia) {
      throw new Error('Message must have either text content or mediaUrl');
    }
    return true;
  }),
];

export const getMessagesValidation = [
  param('conversationId')
    .notEmpty()
    .withMessage('conversationId is required')
    .isMongoId()
    .withMessage('conversationId must be a valid MongoDB ObjectId'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be an integer between 1 and 100'),
  query('before')
    .optional()
    .isISO8601()
    .withMessage('before must be a valid ISO8601 date string'),
];

export const getConversationsValidation = [
  query('type')
    .optional()
    .isIn(Object.values(CONVERSATION_TYPES))
    .withMessage(`type must be one of: ${Object.values(CONVERSATION_TYPES).join(', ')}`),
];
