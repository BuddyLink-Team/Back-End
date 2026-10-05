import dotenv from 'dotenv';

dotenv.config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',

  // Business timezone used for daily/monthly quota periods (users are in Vietnam)
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh',

  // Number of reverse proxies in front of the app (Render/Railway/Nginx: 1).
  // Required so req.ip (used by rate limiters) is the real client IP, not the proxy's.
  TRUST_PROXY: process.env.TRUST_PROXY !== undefined
    ? parseInt(process.env.TRUST_PROXY, 10) || 0
    : process.env.NODE_ENV === 'production' ? 1 : 0,

  // Refresh-token cookie SameSite: 'lax' when frontend and API share a site, 'none' when they are on
  // different domains (requires HTTPS)

  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/buddylink_db',

  JWT: {
    SECRET: process.env.JWT_SECRET || 'buddylink_default_jwt_secret',
    REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'buddylink_default_refresh_secret',
    ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  AI: {
    PROVIDER: process.env.AI_PROVIDER || 'gemini',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  },

  PAYOS: {
    CLIENT_ID: process.env.PAYOS_CLIENT_ID || '',
    API_KEY: process.env.PAYOS_API_KEY || '',
    CHECKSUM_KEY: process.env.PAYOS_CHECKSUM_KEY || '',
    RETURN_URL: process.env.PAYOS_RETURN_URL || 'http://localhost:5173/payment/success',
    CANCEL_URL: process.env.PAYOS_CANCEL_URL || 'http://localhost:5173/payment/cancel',
  },

  GOOGLE_MAPS: {
    API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
  },

  GOOGLE: {
    CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  },

  EMAIL: {
    SMTP_HOST: process.env.SMTP_HOST || '',
    SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
    FROM: process.env.EMAIL_FROM || 'no-reply@buddylink.com',
  },

  STORAGE: {
    PROVIDER: process.env.STORAGE_PROVIDER || 'cloudinary',
    BUCKET: process.env.STORAGE_BUCKET || '',
    ACCESS_KEY: process.env.STORAGE_ACCESS_KEY || '',
    SECRET_KEY: process.env.STORAGE_SECRET_KEY || '',
  },
};

export default env;
