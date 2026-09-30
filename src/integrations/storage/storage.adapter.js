import { v2 as cloudinary } from 'cloudinary';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/AppError.js';

class StorageAdapter {
  constructor() {
    this.isCloudinaryConfigured = false;
    this.initCloudinary();
  }

  initCloudinary() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || env.STORAGE?.BUCKET;
    const apiKey = process.env.CLOUDINARY_API_KEY || env.STORAGE?.ACCESS_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET || env.STORAGE?.SECRET_KEY;

    if (
      cloudName &&
      apiKey &&
      apiSecret &&
      !cloudName.startsWith('<') &&
      !apiKey.startsWith('<') &&
      !apiSecret.startsWith('<')
    ) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
      this.isCloudinaryConfigured = true;
      logger.info('Cloudinary Storage adapter configured successfully');
    } else {
      logger.info('Cloud Storage running in fallback inline mode (base64 data URL).');
    }
  }

  /**
   * Upload an image file buffer to cloud storage (or fallback)
   * @param {Object} file Express.Multer file object
   * @param {string} folder Target folder name
   * @returns {Promise<{ url: string, publicId: string }>}
   */
  async uploadImage(file, folder = 'buddylink/chat') {
    if (!file) {
      throw new AppError('No file provided for upload', 400, 'FILE_REQUIRED');
    }

    // Allowed mime types
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppError('Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed', 400, 'INVALID_FILE_TYPE');
    }

    if (this.isCloudinaryConfigured) {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: 'image',
          },
          (error, result) => {
            if (error) {
              logger.error(`Cloudinary upload failed: ${error.message}`);
              return reject(new AppError('Failed to upload file to Cloud Storage', 500, 'STORAGE_UPLOAD_ERROR'));
            }
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
            });
          }
        );
        uploadStream.end(file.buffer);
      });
    }

    // Fallback mode: Convert buffer to data URI for development & testing
    const base64 = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64}`;
    return {
      url: dataUri,
      publicId: `local-${Date.now()}-${file.originalname}`,
    };
  }
}

export const storageAdapter = new StorageAdapter();
export default storageAdapter;
