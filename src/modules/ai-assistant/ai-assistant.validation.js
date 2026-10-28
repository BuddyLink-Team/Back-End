import { body, param, query } from 'express-validator';
import { AI_LIMITS } from './ai-assistant.constants.js';

export const sessionIdValidation = [param('id').isMongoId().withMessage('Invalid chat session ID')];

export const listSessionsValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: AI_LIMITS.SESSIONS_MAX_PAGE_SIZE })
    .withMessage(`limit must be between 1 and ${AI_LIMITS.SESSIONS_MAX_PAGE_SIZE}`),
];

export const sendMessageValidation = [
  ...sessionIdValidation,
  body('content')
    .isString()
    .withMessage('Message content must be a string')
    .bail()
    .trim()
    .notEmpty()
    .withMessage('Message content is required')
    .isLength({ max: AI_LIMITS.MAX_MESSAGE_LENGTH })
    .withMessage(`Message content must be at most ${AI_LIMITS.MAX_MESSAGE_LENGTH} characters`),
  body('choice').optional().isObject().withMessage('choice must be an object'),
  body('choice.messageId')
    .if(body('choice').exists())
    .isMongoId()
    .withMessage('Invalid choice messageId'),
  body('choice.stepId')
    .if(body('choice').exists())
    .isString()
    .trim()
    .notEmpty()
    .withMessage('choice.stepId is required'),
  body('choice.optionIds')
    .optional()
    .isArray({ max: AI_LIMITS.MAX_PLAYMATE_OPTIONS })
    .withMessage('choice.optionIds must be an array'),
  body('choice.optionIds.*')
    .optional()
    .isString()
    .isLength({ max: AI_LIMITS.OPTION_ID_MAX_LENGTH })
    .withMessage(`Each option id must be a string of at most ${AI_LIMITS.OPTION_ID_MAX_LENGTH} characters`),
  body('choice.custom').optional().isObject().withMessage('choice.custom must be an object'),
  body('choice').custom((choice) => {
    if (choice && !choice.custom && !(Array.isArray(choice.optionIds) && choice.optionIds.length)) {
      throw new Error('choice needs optionIds or custom');
    }
    return true;
  }),
];
