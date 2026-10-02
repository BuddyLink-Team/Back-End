import { v2 as cloudinary } from 'cloudinary';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/AppError.js';

let isConfigured = false;

function ensureCloudinaryConfig() {
  if (isConfigured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || env.STORAGE?.BUCKET;
  const apiKey = process.env.CLOUDINARY_API_KEY || env.STORAGE?.ACCESS_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || env.STORAGE?.SECRET_KEY;

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    isConfigured = true;
    logger.info('[Cloudinary] Cloudinary configured successfully');
  } else {
    logger.warn('[Cloudinary] Missing Cloudinary credentials. Image uploads may fail unless running with mocks.');
  }
}

/**
 * Cloudinary Storage Adapter following BuddyLink integration spec
 */
class CloudinaryAdapter {
  constructor() {
    ensureCloudinaryConfig();
  }

  /**
   * Upload an image buffer to Cloudinary
   * @param {Buffer} buffer - File buffer
   * @param {Object} options - Upload options (folder, public_id, transformation...)
   * @returns {Promise<{ url: string, publicId: string }>}
   */
  async uploadImage(buffer, options = {}) {
    ensureCloudinaryConfig();

    if (!buffer) {
      throw new AppError('No file buffer provided for upload', 400, 'UPLOAD_BUFFER_EMPTY');
    }

    const folder = options.folder || 'buddylink/avatars';

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: options.transformation || [
            { width: 500, height: 500, crop: 'limit' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
          ...options,
        },
        (error, result) => {
          if (error) {
            logger.error(`[Cloudinary] Upload failed: ${error.message}`);
            return reject(new AppError('Failed to upload image', 500, 'STORAGE_UPLOAD_ERROR', [error.message]));
          }
          resolve({
            url: result.secure_url || result.url,
            publicId: result.public_id,
          });
        }
      );

      uploadStream.end(buffer);
    });
  }

  /**
   * Delete an image by public ID
   * @param {string} publicId
   * @returns {Promise<Object>}
   */
  async deleteImage(publicId) {
    ensureCloudinaryConfig();
    try {
      return await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      logger.warn(`[Cloudinary] Delete failed for ${publicId}: ${error.message}`);
      return null;
    }
  }
}

export default new CloudinaryAdapter();
