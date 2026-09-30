import multer from 'multer';
import AppError from '../shared/exceptions/AppError.js';

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only JPEG, PNG, WEBP and GIF images are allowed', 400, 'INVALID_FILE_TYPE'), false);
  }
};

export const uploadSingleImage = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter,
}).single('image');

export const handleUploadError = (err, _req, _res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('File size cannot exceed 5MB', 400, 'FILE_TOO_LARGE'));
    }
    return next(new AppError(err.message, 400, 'FILE_UPLOAD_ERROR'));
  }
  return next(err);
};
