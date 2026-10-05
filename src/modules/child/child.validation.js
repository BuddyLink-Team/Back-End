import { body, param } from 'express-validator';
import { CHILD_GENDERS } from './child.constants.js';

const TAG_LIST_MAX_ITEMS = 20;
const TAG_MAX_LENGTH = 50;

/**
 * Build fresh validation chains for child fields.
 * express-validator chains are mutable (calling .optional() changes the chain itself),
 * so create and update must each get their own instances instead of sharing one array.
 * @param {{ isUpdate: boolean }} options
 */
const buildChildFieldValidation = ({ isUpdate }) => {
  const field = (name) => (isUpdate ? body(name).optional() : body(name));

  const tagList = (name, label) => [
    body(name)
      .optional()
      .isArray({ max: TAG_LIST_MAX_ITEMS })
      .withMessage(`${label} must be an array of at most ${TAG_LIST_MAX_ITEMS} items`),
    body(`${name}.*`)
      .isString()
      .withMessage(`${label} items must be strings`)
      .trim()
      .notEmpty()
      .withMessage(`${label} items cannot be empty`)
      .isLength({ max: TAG_MAX_LENGTH })
      .withMessage(`${label} items cannot exceed ${TAG_MAX_LENGTH} characters`),
  ];

  return [
    field('displayName')
      .isString()
      .withMessage('Child display name must be a string')
      .trim()
      .notEmpty()
      .withMessage('Child display name is required')
      .isLength({ min: 2, max: 50 })
      .withMessage('Child display name must be between 2 and 50 characters'),
    field('dateOfBirth')
      .notEmpty()
      .withMessage('Child date of birth is required')
      .isISO8601()
      .withMessage('Date of birth must be a valid date format (YYYY-MM-DD)')
      .toDate()
      .custom((value) => {
        if (value > new Date()) {
          throw new Error('Date of birth cannot be in the future');
        }
        return true;
      }),
    field('gender')
      .isString()
      .withMessage('Child gender must be a string')
      .trim()
      .notEmpty()
      .withMessage('Child gender is required')
      .isIn(Object.values(CHILD_GENDERS))
      .withMessage(`Gender must be one of: ${Object.values(CHILD_GENDERS).join(', ')}`),
    ...tagList('interests', 'Interests'),
    ...tagList('favoriteActivities', 'Favorite activities'),
    ...tagList('personality', 'Personality traits'),
  ];
};

export const childIdParamValidation = [
  param('id').isMongoId().withMessage('Invalid child ID format'),
];

export const createChildValidation = buildChildFieldValidation({ isUpdate: false });

export const updateChildValidation = [
  ...childIdParamValidation,
  ...buildChildFieldValidation({ isUpdate: true }),
];
