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
  // Ownership of the URL (our Cloud Storage only) is enforced in chatService.sendMessage,
  // which is shared by the REST and socket paths
  body('mediaUrl')
    .optional()
    .isString()
    .withMessage('mediaUrl must be a string'),
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
    .isMongoId()
    .withMessage('before must be a valid message id'),
];

export const getConversationsValidation = [
  query('type')
    .optional()
    .isIn(Object.values(CONVERSATION_TYPES))
    .withMessage(`type must be one of: ${Object.values(CONVERSATION_TYPES).join(', ')}`),
];
