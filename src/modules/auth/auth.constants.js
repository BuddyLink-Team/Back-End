export const TOKEN_TYPES = Object.freeze({
  ACCESS: "access",
  REFRESH: "refresh",
  PHONE_OTP: "phone_otp",
  PASSWORD_RESET: "password_reset",
  EMAIL_VERIFY: "email_verify",
});

export const AUTH_COOKIE_NAMES = Object.freeze({
  ACCESS_TOKEN: "accessToken",
  REFRESH_TOKEN: "refreshToken",
});

export const OTP_CONFIG = Object.freeze({
  LENGTH: 6,
  EXPIRES_IN_MINUTES: 5,
  EMAIL_EXPIRES_IN_MINUTES: 10,
  PASSWORD_RESET_EXPIRES_IN_MINUTES: 15,
  // Wrong codes allowed per issued token before it is invalidated (6-digit space = 1,000,000)
  MAX_ATTEMPTS: 5,
});

// Per-IP limits for endpoints that send or verify one-time codes
export const OTP_RATE_LIMIT = Object.freeze({
  WINDOW_MS: 15 * 60 * 1000,
  MAX_SEND_REQUESTS: 5,
  MAX_VERIFY_REQUESTS: 10,
});
