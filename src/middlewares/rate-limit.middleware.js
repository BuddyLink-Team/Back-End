import rateLimit from 'express-rate-limit';
import { OTP_RATE_LIMIT } from '../modules/auth/auth.constants.js';
import { AI_MESSAGE_RATE_LIMIT } from '../modules/ai-assistant/ai-assistant.constants.js';
import { errorResponse } from '../shared/response/index.js';

export const buildLimiter = ({ windowMs, max, message, skip, keyGenerator, code = 'TOO_MANY_REQUESTS' }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(skip ? { skip } : {}),
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res, next, options) =>
      errorResponse(res, message, options.statusCode, { code, details: [] }),
  });

// Whole API (payment verification is polled by the client, so it is not counted)
export const apiLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later.',
  skip: (req) => req.originalUrl?.includes('/subscriptions/payments/verify/'),
});

// Admin portal sign-in (password guessing against the most privileged accounts)
export const adminLoginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts, please try again later.',
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

// AI assistant messages, per signed-in parent (each message can call the model several times).
// Mounted after authenticate, so req.userId is set.
export const aiMessageLimiter = buildLimiter({
  windowMs: AI_MESSAGE_RATE_LIMIT.WINDOW_MS,
  max: AI_MESSAGE_RATE_LIMIT.MAX_REQUESTS,
  message: 'You are sending messages too quickly, please wait a moment.',
  keyGenerator: (req) => `ai:${req.userId}`,
  code: 'AI_RATE_LIMITED',
});
