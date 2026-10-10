import rateLimit from 'express-rate-limit';
import { OTP_RATE_LIMIT } from '../modules/auth/auth.constants.js';
import { errorResponse } from '../shared/response/index.js';

export const buildLimiter = ({ windowMs, max, message, skip }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(skip ? { skip } : {}),
    handler: (req, res, next, options) =>
      errorResponse(res, message, options.statusCode, { code: 'TOO_MANY_REQUESTS', details: [] }),
  });

// Whole API (payment verification is polled by the client, so it is not counted)
export const apiLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later.',
  skip: (req) => req.originalUrl?.includes('/subscriptions/payments/verify/'),
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
