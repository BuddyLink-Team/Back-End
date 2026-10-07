import { query, body } from 'express-validator';

/**
 * Validation rules for GET /api/v1/discovery
 */
export const discoveryQueryValidation = [
  query('lat')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90')
    .bail()
    .custom((_value, { req }) => req.query.lng !== undefined)
    .withMessage('Latitude and longitude must be provided together'),
  query('lng')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180')
    .bail()
    .custom((_value, { req }) => req.query.lat !== undefined)
    .withMessage('Latitude and longitude must be provided together'),
  query('maxDistanceKm')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Max distance must be between 1 and 100 km'),
  query('ageMin')
    .optional()
    .isInt({ min: 0, max: 18 })
    .withMessage('Minimum age must be between 0 and 18'),
  query('ageMax')
    .optional()
    .isInt({ min: 0, max: 18 })
    .withMessage('Maximum age must be between 0 and 18')
    .bail()
    .custom((value, { req }) =>
      req.query.ageMin === undefined || parseInt(req.query.ageMin, 10) <= parseInt(value, 10)
    )
    .withMessage('Maximum age must be greater than or equal to minimum age'),
  query('childId')
    .optional()
    .isMongoId()
    .withMessage('Invalid child profile ID'),
  query('interests')
    .optional()
    .isString()
    .withMessage('Interests must be a comma-separated string'),
];

/**
 * Validation rules for POST /api/v1/discovery/swipe
 */
export const swipeValidation = [
  body('targetChildId')
    .notEmpty()
    .withMessage('Target child ID is required')
    .isMongoId()
    .withMessage('Invalid child profile ID'),
  body('isLike')
    .notEmpty()
    .withMessage('isLike is required')
    .isBoolean()
    .withMessage('isLike must be a boolean value'),
];
