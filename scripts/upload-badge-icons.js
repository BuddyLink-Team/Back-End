/**
 * Upload the badge images (assets/badges/<code>.svg) to Cloudinary, folder buddylink/badges,
 * with the badge code as public id. Re-uploading overwrites the image and gives it a new version,
 * so update the printed URLs in BADGE_ICON_URLS (src/modules/gamification/gamification.constants.js).
 *
 * Usage:
 *   npm run badges:upload
 *
 * Uses CLOUDINARY_* or STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY from .env.
 */
/* eslint-disable no-console -- CLI script output */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/badges');
const FOLDER = 'buddylink/badges';

dotenv.config();

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.STORAGE_BUCKET;
const apiKey = process.env.CLOUDINARY_API_KEY || process.env.STORAGE_ACCESS_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.STORAGE_SECRET_KEY;

if (!cloudName || !apiKey || !apiSecret) {
  console.error('Cloudinary credentials are missing in .env');
  process.exit(1);
}

cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

const files = (await readdir(ASSETS_DIR)).filter((file) => file.endsWith('.svg')).sort();
const urls = {};

for (const file of files) {
  const code = path.basename(file, '.svg');
  const result = await cloudinary.uploader.upload(path.join(ASSETS_DIR, file), {
    folder: FOLDER,
    public_id: code,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
  });
  urls[code] = result.secure_url;
  console.log(`Uploaded ${code}`);
}

console.log('\nBADGE_ICON_URLS:');
console.log(JSON.stringify(urls, null, 2));
