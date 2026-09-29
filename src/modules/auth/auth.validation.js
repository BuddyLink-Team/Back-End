import { body } from "express-validator";

export const registerValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),
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
    .normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
];

export const googleAuthValidation = [
  body("idToken").trim().notEmpty().withMessage("Google idToken is required"),
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
    .withMessage("OTP must be a 6-digit code"),
];

export const verifyFirebasePhoneValidation = [
  body("idToken").trim().notEmpty().withMessage("Firebase idToken is required"),
];

export const verifyEmailOtpValidation = [
  body("otp")
    .trim()
    .isLength({ min: 6, max: 6 })
    .withMessage("OTP must be a 6-digit code"),
];

export const forgotPasswordValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),
];

export const resetPasswordValidation = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),
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
