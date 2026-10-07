import rateLimit from 'express-rate-limit';
import { OTP_RATE_LIMIT } from '../modules/auth/auth.constants.js';

const buildLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message,
      data: null,
      error: {
        code: 'TOO_MANY_REQUESTS',
        details: [],
      },
    },
  });

// Endpoints that send a one-time code (SMS/email cost + spam to the recipient)
export const otpSendLimiter = buildLimiter({
  windowMs: OTP_RATE_LIMIT.WINDOW_MS,
  max: OTP_RATE_LIMIT.MAX_SEND_REQUESTS,
  message: 'Too many code requests, please try again later.',
});

// Endpoints that check a one-time code (brute force protection, on top of per-token attempts)
export const otpVerifyLimiter = buildLimiter({
  windowMs: OTP_RATE_LIMIT.WINDOW_MS,
  max: OTP_RATE_LIMIT.MAX_VERIFY_REQUESTS,
  message: 'Too many verification attempts, please try again later.',
});
