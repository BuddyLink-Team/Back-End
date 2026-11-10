import { body } from "express-validator";

// Emails are only trimmed and lower-cased (not normalizeEmail()): stripping Gmail dots or
// "+tags" would map the address typed here to a different account than Google login uses.

export const registerValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .toLowerCase(),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Full name must be between 2 and 100 characters"),
  body("phone")
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^\+?[0-9]{9,15}$/)
    .withMessage("Invalid phone number format"),
];

export const loginValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .toLowerCase(),
  body("password").notEmpty().withMessage("Password is required"),
];

// The Google One Tap / GSI button sends an ID token, the web app's own button an OAuth access token
export const googleAuthValidation = [
  body("idToken").optional().isString().trim(),
  body("accessToken").optional().isString().trim(),
  body().custom((value) => {
    if (!value?.idToken && !value?.accessToken) {
      throw new Error("Google idToken or accessToken is required");
    }
    return true;
  }),
];

export const sendPhoneOtpValidation = [
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^\+?[0-9]{9,15}$/)
    .withMessage("Invalid phone number format. Must contain 9 to 15 digits"),
];

export const verifyPhoneOtpValidation = [
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .matches(/^\+?[0-9]{9,15}$/)
    .withMessage("Invalid phone number format"),
  body("otp")
    .trim()
    .isLength({ min: 6, max: 6 })
    .isNumeric({ no_symbols: true })
    .withMessage("OTP must be a 6-digit code"),
];

export const verifyFirebasePhoneValidation = [
  body("idToken").trim().notEmpty().withMessage("Firebase idToken is required"),
];

export const verifyEmailOtpValidation = [
  body("otp")
    .trim()
    .isLength({ min: 6, max: 6 })
    .isNumeric({ no_symbols: true })
    .withMessage("OTP must be a 6-digit code"),
];

export const forgotPasswordValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .toLowerCase(),
];

export const resetPasswordValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .toLowerCase(),
  body("token").trim().notEmpty().withMessage("Reset token/code is required"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long"),
];

export const refreshTokenValidation = [
  body("refreshToken")
    .optional()
    .isString()
    .withMessage("Refresh token must be a string"),
];
