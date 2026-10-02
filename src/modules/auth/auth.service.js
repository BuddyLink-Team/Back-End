import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '../../config/env.js';
import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import authRepository from './auth.repository.js';
import mailAdapter from '../../integrations/mail/mail.adapter.js';
import smsAdapter from '../../integrations/sms/sms.adapter.js';
import googleAuthAdapter from '../../integrations/google/google-auth.adapter.js';
import { verifyFirebasePhoneToken } from '../../integrations/firebase/firebase.adapter.js';
import AppError from '../../shared/exceptions/AppError.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import {
  TOKEN_TYPES,
  OTP_CONFIG,
} from './auth.constants.js';
import {
  createAccessToken,
  createRefreshTokenValue,
  hashToken,
} from '../../shared/helpers/token.helper.js';
import {
  AuthResponseDTO,
  AuthUserDTO,
  TokenPairDTO,
  VerificationStatusDTO,
} from './auth.dto.js';

class AuthService {
  /**
   * Helper to generate pairs of accessToken and refreshToken
   */
  async _generateTokenPair(user) {
    const accessToken = createAccessToken(user);
    const refreshTokenValue = createRefreshTokenValue(user);
    const refreshTokenHash = hashToken(refreshTokenValue);

    // Calculate expiry date for refresh token
    const decodedRefresh = jwt.decode(refreshTokenValue);
    const expiresAt = decodedRefresh?.exp
      ? new Date(decodedRefresh.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await authRepository.createRefreshToken({
      userId: user._id,
      tokenHash: refreshTokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }

  /**
   * Generate 6-digit OTP using crypto.randomInt (Cryptographically Secure)
   */
  _generateOtp() {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Register standard parent account
   */
  async register({ fullName, email, password, phone }) {
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await userService.getUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new AppError('Email is already registered', 409, 'EMAIL_ALREADY_EXISTS');
    }

    const trimmedPhone = phone ? phone.trim() : null;
    if (trimmedPhone) {
      const existingPhone = await userService.getUserByPhone(trimmedPhone);
      if (existingPhone) {
        throw new AppError('Phone number is already registered', 409, 'PHONE_ALREADY_EXISTS');
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await userService.createUser({
      email: normalizedEmail,
      phone: trimmedPhone || undefined,
      passwordHash,
      role: USER_ROLES.PARENT,
      isActive: true,
    });

    const parent = await parentService.createParentProfile({
      userId: user._id,
      fullName: fullName.trim(),
      verification: {
        isEmailVerified: false,
        isPhoneVerified: false,
        isVerifiedParent: false,
      },
    });

    // Automatically create a Free subscription for the registered parent
    await subscriptionService.createFreeSubscription(parent._id);

    const tokens = await this._generateTokenPair(user);

    return {
      dto: AuthResponseDTO.toResponse({ user, parent, tokens }),
      tokens,
    };
  }

  /**
   * Google OAuth Login / Registration
   */
  async loginWithGoogle({ idToken }) {
    const googleUser = await googleAuthAdapter.verifyIdToken(idToken);
    const normalizedEmail = googleUser.email.toLowerCase().trim();

    let user = await userService.getUserByEmail(normalizedEmail);
    let parent = null;

    if (!user) {
      // Create new user & parent
      user = await userService.createUser({
        email: normalizedEmail,
        googleId: googleUser.googleId,
        passwordHash: null,
        role: USER_ROLES.PARENT,
        isActive: true,
      });

      parent = await parentService.createParentProfile({
        userId: user._id,
        fullName: googleUser.fullName,
        avatarUrl: googleUser.avatarUrl,
        verification: {
          isEmailVerified: true, // Google email is already verified
          isPhoneVerified: false,
          isVerifiedParent: false,
        },
      });

      // Automatically create a Free subscription for the registered parent
      await subscriptionService.createFreeSubscription(parent._id);
    } else {
      if (!user.isActive) {
        throw new AppError('User account is disabled', 403, 'ACCOUNT_DISABLED');
      }

      // Update googleId if not linked yet
      if (!user.googleId) {
        user = await userService.getUserById(user._id);
        user.googleId = googleUser.googleId;
        await user.save();
      }

      parent = await parentService.getParentByUserId(user._id);

      // Auto-verify email if not verified
      if (parent && !parent.verification?.isEmailVerified) {
        parent = await parentService.updateVerification(user._id, { isEmailVerified: true });
      }
    }

    const tokens = await this._generateTokenPair(user);

    return {
      dto: AuthResponseDTO.toResponse({ user, parent, tokens }),
      tokens,
    };
  }

  /**
   * Universal Login (Email + Password) for both Parent and Admin
   */
  async login({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userService.getUserByEmail(normalizedEmail);

    if (!user || !user.passwordHash) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('User account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    // If user is parent, get parent profile; if admin, parent is null
    const parent = user.role === USER_ROLES.PARENT || user.role === 'parent'
      ? await parentService.getParentByUserId(user._id)
      : null;

    const tokens = await this._generateTokenPair(user);

    return {
      dto: AuthResponseDTO.toResponse({ user, parent, tokens }),
      tokens,
    };
  }

  /**
   * Admin Login alias delegating to universal login for backward-compatibility
   */
  async loginAdmin({ email, password }) {
    const result = await this.login({ email, password });
    const role = (result.dto?.user?.role || '').toUpperCase();
    if (role !== USER_ROLES.ADMIN && role !== 'ADMIN') {
      throw new AppError('Access denied: Admin privileges required', 403, 'FORBIDDEN');
    }
    return result;
  }

  /**
   * Send Phone OTP
   */
  async sendPhoneOtp(userId, phone) {
    const otp = this._generateOtp();
    const tokenHash = hashToken(otp);
    const expiresAt = new Date(Date.now() + OTP_CONFIG.EXPIRES_IN_MINUTES * 60 * 1000);

    await authRepository.createAuthToken({
      userId,
      target: phone,
      tokenHash,
      type: TOKEN_TYPES.PHONE_OTP,
      expiresAt,
    });

    await smsAdapter.sendPhoneOtp({
      phone,
      otp,
      minutes: OTP_CONFIG.EXPIRES_IN_MINUTES,
    });

    return { message: 'Phone OTP sent successfully' };
  }

  /**
   * Verify Phone OTP
   */
  async verifyPhoneOtp(userId, phone, otp) {
    const tokenHash = hashToken(otp);

    const validToken = await authRepository.findValidAuthToken({
      target: phone,
      tokenHash,
      type: TOKEN_TYPES.PHONE_OTP,
    });

    if (!validToken) {
      throw new AppError('Invalid or expired OTP code', 400, 'INVALID_OTP');
    }

    await authRepository.markAuthTokenUsed(validToken._id);

    // Update phone on User
    await userService.updatePhone(userId, phone);

    // Update verification on Parent
    const parent = await parentService.updateVerification(userId, { isPhoneVerified: true });

    return VerificationStatusDTO.toResponse(parent.verification);
  }

  /**
   * Verify Phone using Firebase ID Token
   * Client performs SMS verification via Firebase SDK and sends idToken
   */
  async verifyFirebasePhone(userId, idToken) {
    let firebaseResult;
    try {
      firebaseResult = await verifyFirebasePhoneToken(idToken);
    } catch (error) {
      throw new AppError(error.message || 'Invalid Firebase ID token', 400, 'INVALID_FIREBASE_TOKEN');
    }

    const verifiedPhone = firebaseResult.phoneNumber;

    // Check if phone is already used by another user
    const existingUser = await userService.getUserByPhone(verifiedPhone);
    if (existingUser && existingUser._id.toString() !== userId.toString()) {
      throw new AppError('Phone number is already associated with another account', 409, 'PHONE_IN_USE');
    }

    // Update phone on User
    await userService.updatePhone(userId, verifiedPhone);

    // Update verification on Parent
    const parent = await parentService.updateVerification(userId, { isPhoneVerified: true });

    return {
      phone: verifiedPhone,
      verification: VerificationStatusDTO.toResponse(parent.verification),
    };
  }

  /**
   * Send Email OTP
   */
  async sendEmailOtp(userId) {
    const user = await userService.getUserById(userId);
    const parent = await parentService.getParentByUserId(userId);

    const otp = this._generateOtp();
    const tokenHash = hashToken(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await authRepository.createAuthToken({
      userId,
      target: user.email,
      tokenHash,
      type: TOKEN_TYPES.EMAIL_VERIFY,
      expiresAt,
    });

    await mailAdapter.sendEmailOtp({
      to: user.email,
      otp,
      fullName: parent?.fullName || 'Parent',
      minutes: 10,
    });

    return { message: 'Email verification code sent successfully' };
  }

  /**
   * Verify Email OTP
   */
  async verifyEmailOtp(userId, otp) {
    const user = await userService.getUserById(userId);
    const tokenHash = hashToken(otp);

    const validToken = await authRepository.findValidAuthToken({
      target: user.email,
      tokenHash,
      type: TOKEN_TYPES.EMAIL_VERIFY,
    });

    if (!validToken) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    await authRepository.markAuthTokenUsed(validToken._id);

    const parent = await parentService.updateVerification(userId, { isEmailVerified: true });

    return VerificationStatusDTO.toResponse(parent.verification);
  }

  /**
   * Forgot Password
   */
  async forgotPassword(email) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userService.getUserByEmail(normalizedEmail);

    // If user does not exist, return success message anyway to prevent account enumeration
    if (!user) {
      return { message: 'If that email is registered, a password reset code has been sent' };
    }

    const resetOtp = this._generateOtp();
    const tokenHash = hashToken(resetOtp);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await authRepository.createAuthToken({
      userId: user._id,
      target: normalizedEmail,
      tokenHash,
      type: TOKEN_TYPES.PASSWORD_RESET,
      expiresAt,
    });

    const parent = await parentService.getParentByUserId(user._id);

    await mailAdapter.sendPasswordResetEmail({
      to: normalizedEmail,
      token: resetOtp,
      fullName: parent?.fullName || 'User',
      minutes: 15,
    });

    return { message: 'If that email is registered, a password reset code has been sent' };
  }

  /**
   * Reset Password
   */
  async resetPassword({ email, token, newPassword }) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userService.getUserByEmail(normalizedEmail);
    if (!user) {
      throw new AppError('Invalid or expired reset token', 400, 'INVALID_RESET_TOKEN');
    }

    const tokenHash = hashToken(token);
    const validToken = await authRepository.findValidAuthToken({
      target: normalizedEmail,
      tokenHash,
      type: TOKEN_TYPES.PASSWORD_RESET,
    });

    if (!validToken) {
      throw new AppError('Invalid or expired reset token', 400, 'INVALID_RESET_TOKEN');
    }

    await authRepository.markAuthTokenUsed(validToken._id);

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await userService.updatePassword(user._id, passwordHash);

    // Revoke all existing sessions for security
    await authRepository.revokeAllUserRefreshTokens(user._id);

    return { message: 'Password has been successfully reset' };
  }

  /**
   * Refresh Token with Token Rotation
   */
  async refreshToken(rawRefreshToken) {
    if (!rawRefreshToken) {
      throw new AppError('Refresh token required', 401, 'REFRESH_TOKEN_REQUIRED');
    }

    const secret = env.JWT.REFRESH_SECRET || process.env.JWT_REFRESH_SECRET;
    let decoded;
    try {
      decoded = jwt.verify(rawRefreshToken, secret);
    } catch {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const tokenHash = hashToken(rawRefreshToken);
    const storedToken = await authRepository.findRefreshTokenByHash(tokenHash);

    if (!storedToken || storedToken.isRevoked) {
      throw new AppError('Refresh token has been revoked', 401, 'TOKEN_REVOKED');
    }

    // Revoke current token (Token Rotation)
    await authRepository.revokeRefreshToken(tokenHash);

    const user = await userService.getUserById(decoded.sub);
    if (!user || !user.isActive) {
      throw new AppError('User not found or account inactive', 401, 'USER_INACTIVE');
    }

    const newTokens = await this._generateTokenPair(user);

    return {
      dto: TokenPairDTO.toResponse(newTokens),
      tokens: newTokens,
    };
  }

  /**
   * Logout (Revoke refresh token)
   */
  async logout(rawRefreshToken) {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await authRepository.revokeRefreshToken(tokenHash);
    }
    return { message: 'Logged out successfully' };
  }

  /**
   * Get Current Authenticated User & Parent Profile
   */
  async getMe(userId) {
    const user = await userService.getUserById(userId);
    const parent = await parentService.getParentByUserId(userId);
    return AuthUserDTO.toResponse({ user, parent });
  }
}

export default new AuthService();
