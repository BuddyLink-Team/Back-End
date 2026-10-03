import { body } from 'express-validator';

export const changeUserPasswordValidation = [
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

export const updateUserProfileValidation = [
  body('phone')
    .optional()
    .isString()
    .trim(),
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
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('preferences')
    .optional()
    .isObject()
    .withMessage('Preferences must be an object'),
  body('privacySettings')
    .optional()
    .isObject()
    .withMessage('PrivacySettings must be an object'),
];
