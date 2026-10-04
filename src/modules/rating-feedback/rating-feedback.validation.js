import { body, param } from 'express-validator';

export const createRatingValidation = [
  param('id').isMongoId().withMessage('Playdate ID không hợp lệ.'),
  body('rating').custom(value => Number.isInteger(value) && value >= 1 && value <= 5)
    .withMessage('Đánh giá phải là số nguyên từ 1 đến 5.'),
  body('feedback').optional().isString().withMessage('Feedback phải là chuỗi.').trim(),
];
