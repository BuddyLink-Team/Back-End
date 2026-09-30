import multer from 'multer';
import AppError from '../shared/exceptions/AppError.js';

// Memory storage keeps file buffer in memory for direct upload to Cloudinary/S3
const storage = multer.memoryStorage();

// Accept image files only
const imageFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(
      new AppError('Only image files (jpg, jpeg, png, webp) are allowed', 400, 'INVALID_FILE_TYPE'),
      false
    );
  }
};

export const uploadAvatar = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

export default {
  uploadAvatar,
};
