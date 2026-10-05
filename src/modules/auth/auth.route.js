import { Router } from 'express';
import authController from './auth.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { otpSendLimiter, otpVerifyLimiter } from '../../middlewares/rate-limit.middleware.js';
import {
  registerValidation,
  loginValidation,
  googleAuthValidation,
  sendPhoneOtpValidation,
  verifyPhoneOtpValidation,
  verifyFirebasePhoneValidation,
  verifyEmailOtpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  refreshTokenValidation,
} from './auth.validation.js';

const router = Router();

// Public routes
router.post('/register', validate(registerValidation), authController.register);
router.post('/google', validate(googleAuthValidation), authController.googleAuth);
router.post('/login', validate(loginValidation), authController.login);
router.post('/admin/login', validate(loginValidation), authController.loginAdmin);
router.post('/forgot-password', otpSendLimiter, validate(forgotPasswordValidation), authController.forgotPassword);
router.post('/reset-password', otpVerifyLimiter, validate(resetPasswordValidation), authController.resetPassword);
router.post('/refresh-token', validate(refreshTokenValidation), authController.refreshToken);
router.post('/logout', authController.logout);

// Protected routes (require valid JWT)
router.get('/me', authenticate, authController.getMe);
router.post('/phone/send-otp', authenticate, otpSendLimiter, validate(sendPhoneOtpValidation), authController.sendPhoneOtp);
router.post('/phone/verify-otp', authenticate, otpVerifyLimiter, validate(verifyPhoneOtpValidation), authController.verifyPhoneOtp);
router.post('/phone/verify-firebase', authenticate, validate(verifyFirebasePhoneValidation), authController.verifyFirebasePhone);
router.post('/email/send-otp', authenticate, otpSendLimiter, authController.sendEmailOtp);
router.post('/email/verify-otp', authenticate, otpVerifyLimiter, validate(verifyEmailOtpValidation), authController.verifyEmailOtp);

export default router;
