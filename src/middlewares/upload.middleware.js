import multer from 'multer';
import AppError from '../shared/exceptions/AppError.js';

// Memory storage keeps file buffer in memory for direct upload to Cloudinary/S3
const storage = multer.memoryStorage();

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const imageFilter = (_req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only JPEG, PNG, WEBP and GIF images are allowed', 400, 'INVALID_FILE_TYPE'), false);
  }
};

const imageUploader = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

// Convert Multer errors into AppError so every upload route responds the same way
const toAppError = (err) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError('File size cannot exceed 5MB', 400, 'FILE_TOO_LARGE');
    }
    return new AppError(err.message, 400, 'FILE_UPLOAD_ERROR');
  }
  return err;
};

// Single-image upload middleware for the given form field, with error handling built in
const singleImage = (fieldName) => (req, res, next) => {
  imageUploader.single(fieldName)(req, res, (err) => next(err ? toAppError(err) : undefined));
};

export const uploadSingleImage = singleImage('image');
export const uploadAvatar = singleImage('avatar');

export default {
  uploadSingleImage,
  uploadAvatar,
};
