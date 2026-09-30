import { body } from 'express-validator';
import {
  PREFERRED_DAYS,
  TIME_SLOTS,
  PREFERRED_LOCATIONS,
} from './parent.constants.js';

export const onboardingPreferencesValidation = [
  body('location').optional().isObject().withMessage('Location must be an object'),
  body('location.address').optional().isString().trim(),
  body('location.area').optional().isString().trim(),
  body('location.city').optional().isString().trim(),
  body('location.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [lng, lat]'),
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
    .isNumeric()
    .withMessage('maxDistanceKm must be a number'),
  body('preferences.preferredAgeRange.min')
    .optional()
    .isInt({ min: 0 })
    .withMessage('preferredAgeRange.min must be a non-negative integer'),
  body('preferences.preferredAgeRange.max')
    .optional()
    .isInt({ min: 0 })
    .withMessage('preferredAgeRange.max must be a non-negative integer'),
  body('preferences.languages')
    .optional()
    .isArray()
    .withMessage('languages must be an array of strings'),
];

export const updateParentProfileValidation = [
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
  body('location').optional().isObject().withMessage('Location must be an object'),
  body('location.address').optional().isString().trim(),
  body('location.area').optional().isString().trim(),
  body('location.city').optional().isString().trim(),
  body('location.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [lng, lat]'),
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
    .isNumeric()
    .withMessage('maxDistanceKm must be a number'),
  body('preferences.preferredAgeRange.min')
    .optional()
    .isInt({ min: 0 })
    .withMessage('preferredAgeRange.min must be a non-negative integer'),
  body('preferences.preferredAgeRange.max')
    .optional()
    .isInt({ min: 0 })
    .withMessage('preferredAgeRange.max must be a non-negative integer'),
  body('preferences.languages')
    .optional()
    .isArray()
    .withMessage('languages must be an array of strings'),
  body('privacySettings').optional().isObject().withMessage('privacySettings must be an object'),
  body('privacySettings.isProfileHidden').optional().isBoolean().withMessage('isProfileHidden must be a boolean'),
  body('privacySettings.connectionPrivacy').optional().isIn(['everyone', 'nobody']).withMessage('connectionPrivacy must be either everyone or nobody'),
  body('privacySettings.messagePrivacy').optional().isIn(['connected_only']).withMessage('messagePrivacy must be connected_only'),
];

export const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long'),
  body('confirmNewPassword')
    .notEmpty()
    .withMessage('Confirmation of new password is required')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('New password and confirmation password do not match');
      }
      return true;
    }),
];

