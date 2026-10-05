import { body } from 'express-validator';
import {
  PREFERRED_DAYS,
  TIME_SLOTS,
  PREFERRED_LOCATIONS,
  PREFERENCE_LIMITS,
} from './parent.constants.js';

const locationRules = [
  body('location').optional().isObject().withMessage('Location must be an object'),
  body('location.address').optional().isString().trim().isLength({ max: 255 }),
  body('location.area').optional().isString().trim().isLength({ max: 100 }),
  body('location.city').optional().isString().trim().isLength({ max: 100 }),
  body('location.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [lng, lat]'),
  body('location.coordinates[0]').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180').toFloat(),
  body('location.coordinates[1]').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90').toFloat(),
];

export const onboardingPreferencesValidation = [
  ...locationRules,
  body('preferences').optional().isObject().withMessage('Preferences must be an object'),
  body('preferences.preferredPlaydateDays')
    .optional()
    .isArray()
    .custom((days) => days.every((d) => PREFERRED_DAYS.includes(d)))
    .withMessage(`preferredPlaydateDays must be one of: ${PREFERRED_DAYS.join(', ')}`),
  body('preferences.preferredTimeSlots')
    .optional()
    .isArray()
    .custom((slots) => slots.every((s) => TIME_SLOTS.includes(s)))
    .withMessage(`preferredTimeSlots must be one of: ${TIME_SLOTS.join(', ')}`),
  body('preferences.preferredLocations')
    .optional()
    .isArray()
    .custom((locs) => locs.every((l) => PREFERRED_LOCATIONS.includes(l)))
    .withMessage(`preferredLocations must be one of: ${PREFERRED_LOCATIONS.join(', ')}`),
  body('preferences.maxDistanceKm')
    .optional()
    .isFloat({ min: PREFERENCE_LIMITS.MIN_DISTANCE_KM, max: PREFERENCE_LIMITS.MAX_DISTANCE_KM })
    .withMessage(`maxDistanceKm must be between ${PREFERENCE_LIMITS.MIN_DISTANCE_KM} and ${PREFERENCE_LIMITS.MAX_DISTANCE_KM}`)
    .toFloat(),
  body('preferences.preferredAgeRange.min')
    .optional()
    .isInt({ min: PREFERENCE_LIMITS.MIN_CHILD_AGE, max: PREFERENCE_LIMITS.MAX_CHILD_AGE })
    .withMessage(`preferredAgeRange.min must be an integer between ${PREFERENCE_LIMITS.MIN_CHILD_AGE} and ${PREFERENCE_LIMITS.MAX_CHILD_AGE}`)
    .toInt(),
  body('preferences.preferredAgeRange.max')
    .optional()
    .isInt({ min: PREFERENCE_LIMITS.MIN_CHILD_AGE, max: PREFERENCE_LIMITS.MAX_CHILD_AGE })
    .withMessage(`preferredAgeRange.max must be an integer between ${PREFERENCE_LIMITS.MIN_CHILD_AGE} and ${PREFERENCE_LIMITS.MAX_CHILD_AGE}`)
    .toInt(),
  body('preferences.languages')
    .optional()
    .isArray()
    .withMessage('languages must be an array of strings'),
];

export const updateParentProfileValidation = [
  // Empty string clears the phone number; a changed number must be re-verified via OTP
  body('phone')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Phone must be a string')
    .trim()
    .custom((value) => value === '' || /^\+?[0-9]{9,15}$/.test(value))
    .withMessage('Invalid phone number format. Must contain 9 to 15 digits'),
  body('fullName')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('bio')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),
  ...locationRules,
  body('preferences').optional().isObject().withMessage('Preferences must be an object'),
  body('preferences.preferredPlaydateDays')
    .optional()
    .isArray()
    .custom((days) => days.every((d) => PREFERRED_DAYS.includes(d)))
    .withMessage(`preferredPlaydateDays must be one of: ${PREFERRED_DAYS.join(', ')}`),
  body('preferences.preferredTimeSlots')
    .optional()
    .isArray()
    .custom((slots) => slots.every((s) => TIME_SLOTS.includes(s)))
    .withMessage(`preferredTimeSlots must be one of: ${TIME_SLOTS.join(', ')}`),
  body('preferences.preferredLocations')
    .optional()
    .isArray()
    .custom((locs) => locs.every((l) => PREFERRED_LOCATIONS.includes(l)))
    .withMessage(`preferredLocations must be one of: ${PREFERRED_LOCATIONS.join(', ')}`),
  body('preferences.maxDistanceKm')
    .optional()
    .isFloat({ min: PREFERENCE_LIMITS.MIN_DISTANCE_KM, max: PREFERENCE_LIMITS.MAX_DISTANCE_KM })
    .withMessage(`maxDistanceKm must be between ${PREFERENCE_LIMITS.MIN_DISTANCE_KM} and ${PREFERENCE_LIMITS.MAX_DISTANCE_KM}`)
    .toFloat(),
  body('preferences.preferredAgeRange.min')
    .optional()
    .isInt({ min: PREFERENCE_LIMITS.MIN_CHILD_AGE, max: PREFERENCE_LIMITS.MAX_CHILD_AGE })
    .withMessage(`preferredAgeRange.min must be an integer between ${PREFERENCE_LIMITS.MIN_CHILD_AGE} and ${PREFERENCE_LIMITS.MAX_CHILD_AGE}`)
    .toInt(),
  body('preferences.preferredAgeRange.max')
    .optional()
    .isInt({ min: PREFERENCE_LIMITS.MIN_CHILD_AGE, max: PREFERENCE_LIMITS.MAX_CHILD_AGE })
    .withMessage(`preferredAgeRange.max must be an integer between ${PREFERENCE_LIMITS.MIN_CHILD_AGE} and ${PREFERENCE_LIMITS.MAX_CHILD_AGE}`)
    .toInt(),
  body('preferences.languages')
    .optional()
    .isArray()
    .withMessage('languages must be an array of strings'),
  body('privacySettings').optional().isObject().withMessage('privacySettings must be an object'),
  body('privacySettings.isProfileHidden').optional().isBoolean().withMessage('isProfileHidden must be a boolean'),
  body('privacySettings.connectionPrivacy').optional().isIn(['everyone', 'nobody']).withMessage('connectionPrivacy must be either everyone or nobody'),
  body('privacySettings.messagePrivacy').optional().isIn(['connected_only']).withMessage('messagePrivacy must be connected_only'),
];
