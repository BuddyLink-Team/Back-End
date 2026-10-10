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

// Profile update rules are shared with PUT /parent/me (same update flow), including phone
export { updateParentProfileValidation as updateUserProfileValidation } from '../parent/parent.validation.js';
