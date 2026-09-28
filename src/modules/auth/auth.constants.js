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
});
