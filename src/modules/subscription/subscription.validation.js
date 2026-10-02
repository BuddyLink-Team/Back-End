import { body, param, query, header } from 'express-validator';
import { SUBSCRIPTION_PLAN_CODES } from './subscription.constants.js';

export const checkoutValidation = [
  header('idempotency-key')
    .trim()
    .notEmpty()
    .withMessage('Idempotency-Key header là bắt buộc khi tạo checkout'),
  body('planCode')
    .trim()
    .notEmpty()
    .withMessage('Mã gói cước không được để trống')
    .isIn([
      SUBSCRIPTION_PLAN_CODES.PREMIUM_MONTHLY,
      SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY,
    ])
    .withMessage('Gói cước nâng cấp không hợp lệ'),
];

export const verifyPaymentValidation = [
  param('orderCode')
    .trim()
    .notEmpty()
    .withMessage('Mã đơn hàng không được để trống')
    .isNumeric()
    .withMessage('Mã đơn hàng phải là số'),
];

export const historyQueryValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Số trang phải là số nguyên dương >= 1'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Số lượng mỗi trang phải từ 1 đến 50'),
];
