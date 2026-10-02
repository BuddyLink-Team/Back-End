import { body, param } from 'express-validator';
import { CHILD_GENDERS } from './child.constants.js';

export const createChildValidation = [
  body('displayName')
    .trim()
    .notEmpty()
    .withMessage('Child display name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Child display name must be between 2 and 50 characters'),
  body('dateOfBirth')
    .notEmpty()
    .withMessage('Child date of birth is required')
    .isISO8601()
    .toDate()
    .withMessage('Date of birth must be a valid date format (YYYY-MM-DD)')
    .custom((value) => {
      const birthDate = new Date(value);
      const now = new Date();
      if (birthDate > now) {
        throw new Error('Date of birth cannot be in the future');
      }
      return true;
    }),
  body('gender')
    .trim()
    .notEmpty()
    .withMessage('Child gender is required')
    .isIn(Object.values(CHILD_GENDERS))
    .withMessage(`Gender must be one of: ${Object.values(CHILD_GENDERS).join(', ')}`),
  body('interests')
    .optional()
    .isArray()
    .withMessage('Interests must be an array of strings'),
  body('interests.*')
    .optional()
    .trim()
    .isString(),
  body('favoriteActivities')
    .optional()
    .isArray()
    .withMessage('Favorite activities must be an array of strings'),
  body('favoriteActivities.*')
    .optional()
    .trim()
    .isString(),
  body('personality')
    .optional()
    .isArray()
    .withMessage('Personality traits must be an array of strings'),
  body('personality.*')
    .optional()
    .trim()
    .isString(),
];

export const updateChildValidation = [
  param('id').isMongoId().withMessage('Invalid child ID format'),
  ...createChildValidation.map((validator) => validator.optional()),
];

export const childIdParamValidation = [
  param('id').isMongoId().withMessage('Invalid child ID format'),
];
