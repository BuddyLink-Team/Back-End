import { body, param, query } from 'express-validator';

export const getPlaydatesValidation = [
  query('status')
    .optional()
    .trim()
    .isIn(['all', 'upcoming', 'pending', 'confirmed', 'completed', 'cancelled'])
    .withMessage('Trạng thái lọc không hợp lệ (all, upcoming, pending, confirmed, completed, cancelled)'),
  query('search')
    .optional()
    .trim()
    .isString()
    .withMessage('Từ khóa tìm kiếm phải là chuỗi ký tự'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Trang phải là số nguyên dương'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải là số từ 1 đến 100'),
];

export const playdateIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Mã ID buổi hẹn chơi không hợp lệ'),
];

export const createPlaydateValidation = [
  body('hostChildId')
    .notEmpty()
    .withMessage('Vui lòng chọn bé tham gia của bạn')
    .isMongoId()
    .withMessage('Mã hồ sơ bé không hợp lệ'),
  body('scheduledDate')
    .notEmpty()
    .withMessage('Ngày hẹn chơi là bắt buộc')
    .isISO8601()
    .toDate()
    .withMessage('Ngày hẹn chơi không hợp lệ'),
  body('time')
    .trim()
    .notEmpty()
    .withMessage('Thời gian hẹn là bắt buộc'),
  body('activity')
    .trim()
    .notEmpty()
    .withMessage('Hoạt động là bắt buộc'),
  body('location.name')
    .trim()
    .notEmpty()
    .withMessage('Tên địa điểm là bắt buộc'),
  body('location.address')
    .trim()
    .notEmpty()
    .withMessage('Địa chỉ là bắt buộc'),
  body('location.placeId')
    .optional()
    .trim()
    .isString(),
  body('note')
    .optional()
    .trim(),
  body('participants')
    .optional()
    .isArray()
    .withMessage('Danh sách người tham gia phải là một mảng'),
  body('participants.*.parentId')
    .optional()
    .isMongoId()
    .withMessage('Mã phụ huynh tham gia không hợp lệ'),
  body('participants.*.childId')
    .optional()
    .isMongoId()
    .withMessage('Mã bé tham gia không hợp lệ'),
];

export const cancelPlaydateValidation = [
  param('id')
    .isMongoId()
    .withMessage('Mã ID buổi hẹn chơi không hợp lệ'),
  body('reason')
    .optional()
    .trim()
    .isString()
    .withMessage('Lý do hủy phải là chuỗi ký tự'),
];
