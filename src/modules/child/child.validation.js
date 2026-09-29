import { body, param } from 'express-validator';
import { CHILD_GENDERS } from './child.constants.js';

export const createChildValidation = [
  body('displayName')
    .trim()
    .notEmpty()
    .withMessage('Tên hoặc biệt danh của bé là bắt buộc')
    .isLength({ min: 2, max: 50 })
    .withMessage('Tên bé phải từ 2 đến 50 ký tự'),
  body('dateOfBirth')
    .notEmpty()
    .withMessage('Ngày sinh của bé là bắt buộc')
    .isISO8601()
    .toDate()
    .withMessage('Ngày sinh phải có định dạng hợp lệ (YYYY-MM-DD)')
    .custom((value) => {
      const birthDate = new Date(value);
      const now = new Date();
      if (birthDate > now) {
        throw new Error('Ngày sinh không thể ở tương lai');
      }
      return true;
    }),
  body('gender')
    .trim()
    .notEmpty()
    .withMessage('Giới tính của bé là bắt buộc')
    .isIn(Object.values(CHILD_GENDERS))
    .withMessage(`Giới tính phải là: ${Object.values(CHILD_GENDERS).join(', ')}`),
  body('interests')
    .optional()
    .isArray()
    .withMessage('Sở thích phải là một mảng chuỗi'),
  body('interests.*')
    .optional()
    .trim()
    .isString(),
  body('favoriteActivities')
    .optional()
    .isArray()
    .withMessage('Hoạt động ưa thích phải là một mảng chuỗi'),
  body('favoriteActivities.*')
    .optional()
    .trim()
    .isString(),
  body('personality')
    .optional()
    .isArray()
    .withMessage('Tính cách phải là một mảng chuỗi'),
  body('personality.*')
    .optional()
    .trim()
    .isString(),
];

export const updateChildValidation = [
  param('id').isMongoId().withMessage('Mã ID của bé không hợp lệ'),
  ...createChildValidation.map((validator) => validator.optional()),
];

export const childIdParamValidation = [
  param('id').isMongoId().withMessage('Mã ID của bé không hợp lệ'),
];
