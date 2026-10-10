import { body, param } from 'express-validator';

export const createRatingValidation = [
  param('id').isMongoId().withMessage('Invalid playdate ID'),
  body('rating').custom(value => Number.isInteger(value) && value >= 1 && value <= 5)
    .withMessage('rating must be an integer from 1 to 5'),
  body('feedback').optional().isString().withMessage('feedback must be a string').trim(),
];
