import { v2 as cloudinary } from 'cloudinary';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/AppError.js';

/**
 * Single Cloud Storage adapter (Cloudinary) for all image uploads (avatars, chat attachments...).
 * Falls back to inline base64 data URLs outside production when Cloudinary is not configured,
 * and never calls the real Cloudinary API in the test environment.
 */
class StorageAdapter {
  constructor() {
    this.isCloudinaryConfigured = false;
    this.cloudName = null;
    this.initCloudinary();
  }

  initCloudinary() {
    if (env.NODE_ENV === 'test') {
      logger.info('Cloud Storage running in test mode (no external uploads).');
      return;
    }

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
      this.cloudName = cloudName;
      logger.info('Cloudinary Storage adapter configured successfully');
    } else {
      logger.warn('Cloudinary credentials missing. Cloud Storage running in fallback inline mode (base64 data URL).');
    }
  }

  /**
   * Upload an image buffer to cloud storage (or fallback)
   * @param {Buffer} buffer - Image file buffer
   * @param {Object} [options]
   * @param {string} [options.folder] - Target folder name
   * @param {Array<Object>} [options.transformation] - Cloudinary transformations
   * @param {string} [options.mimetype] - Verified image mimetype (used by the fallback data URL)
   * @returns {Promise<{ url: string, publicId: string }>}
   */
  async uploadImage(buffer, { folder = 'buddylink/uploads', transformation, mimetype = 'image/jpeg' } = {}) {
    if (!buffer) {
      throw new AppError('No file buffer provided for upload', 400, 'UPLOAD_BUFFER_EMPTY');
    }

    if (this.isCloudinaryConfigured) {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: 'image',
            ...(transformation ? { transformation } : {}),
          },
          (error, result) => {
            if (error) {
              logger.error(`Cloudinary upload failed: ${error.message}`);
              return reject(new AppError('Failed to upload file to Cloud Storage', 500, 'STORAGE_UPLOAD_ERROR'));
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

    if (env.NODE_ENV === 'production') {
      throw new AppError('Cloud Storage is not configured', 500, 'STORAGE_NOT_CONFIGURED');
    }

    // Fallback mode: inline data URL for local development & testing
    return {
      url: `data:${mimetype};base64,${buffer.toString('base64')}`,
      publicId: `local-${Date.now()}`,
    };
  }

  /**
   * Check that a media URL was produced by this adapter, so clients cannot attach
   * arbitrary external links (tracking pixels, phishing images...) to messages.
   * @param {string} url
   * @returns {boolean}
   */
  isOwnedMediaUrl(url) {
    if (typeof url !== 'string') return false;
    const value = url.trim();

    if (this.cloudName) {
      const cloudinaryPrefix = `https://res.cloudinary.com/${this.cloudName}/image/upload/`;
      if (value.startsWith(cloudinaryPrefix) && value.length <= 2048) {
        return true;
      }
    }

    // Fallback uploads (non-production only) are returned as inline data URLs
    return (
      env.NODE_ENV !== 'production' &&
      /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    );
  }

  /**
   * Extract the Cloudinary public ID from a delivery URL of this account, e.g.
   * https://res.cloudinary.com/<cloud>/image/upload/<transformations>/v123/buddylink/x/abc.jpg
   * -> "buddylink/x/abc". Returns null for other URLs (data URLs, external, empty).
   * @param {string} url
   * @returns {string|null}
   */
  getPublicIdFromUrl(url) {
    if (!this.cloudName || typeof url !== 'string') return null;

    const prefix = `https://res.cloudinary.com/${this.cloudName}/image/upload/`;
    if (!url.startsWith(prefix)) return null;

    const segments = url.slice(prefix.length).split('?')[0].split('/');
    const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
    const pathSegments = versionIndex >= 0 ? segments.slice(versionIndex + 1) : segments;
    if (pathSegments.length === 0) return null;

    return pathSegments.join('/').replace(/\.[a-z0-9]+$/i, '') || null;
  }

  /**
   * Delete an image by public ID
   * @param {string} publicId
   * @returns {Promise<Object|null>}
   */
  async deleteImage(publicId) {
    if (!this.isCloudinaryConfigured || !publicId) return null;

    try {
      return await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      logger.warn(`Cloudinary delete failed for ${publicId}: ${error.message}`);
      return null;
    }
  }
}

export const storageAdapter = new StorageAdapter();
export default storageAdapter;
