import { query } from 'express-validator';
import { PLACE_TYPES } from './discovery.constants.js';

/**
 * Validation rules for GET /api/v1/places/nearby
 */
export const getNearbyPlacesValidation = [
  query('lat')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be a valid number between -90 and 90')
    .custom((val, { req }) => {
      if (val !== undefined && req.query.lng === undefined) {
        throw new Error('Both lat and lng must be provided together');
      }
      return true;
    }),
  query('lng')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be a valid number between -180 and 180')
    .custom((val, { req }) => {
      if (val !== undefined && req.query.lat === undefined) {
        throw new Error('Both lat and lng must be provided together');
      }
      return true;
    }),
  query('radius')
    .optional()
    .isInt({ min: 100, max: 50000 })
    .withMessage('Radius must be an integer between 100 and 50,000 meters'),
  query('type')
    .optional()
    .trim()
    .isIn(['all', ...Object.values(PLACE_TYPES)])
    .withMessage(`Type must be one of: all, ${Object.values(PLACE_TYPES).join(', ')}`),
  query('keyword')
    .optional()
    .trim()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Keyword cannot exceed 100 characters'),
  query('search')
    .optional()
    .trim()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Search term cannot exceed 100 characters'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be an integer between 1 and 50'),
];
