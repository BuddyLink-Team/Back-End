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

/**
 * Constant-time comparison of two hex SHA-256 digests
 */
const isSameHash = (hashA, hashB) => {
  const bufferA = Buffer.from(String(hashA), 'hex');
  const bufferB = Buffer.from(String(hashB), 'hex');
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
};

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
   * Issue a new one-time code for a target/type. Previously issued codes are invalidated,
   * so only the latest code can be used.
   * @returns {Promise<string>} The plain code to deliver to the user
   */
  async _issueOtp({ userId, target, type, expiresInMinutes }) {
    const otp = this._generateOtp();

    await authRepository.invalidateActiveAuthTokens({ target, type });
    await authRepository.createAuthToken({
      userId,
      target,
      tokenHash: hashToken(otp),
      type,
      expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
    });

    return otp;
  }

  /**
   * Verify and consume the latest code of a target/type.
   * Each wrong code counts as an attempt; after OTP_CONFIG.MAX_ATTEMPTS the code is invalidated,
   * which turns brute forcing the 6-digit space into requesting a new code every few guesses.
   */
  async _consumeOtp({ userId, target, type, code, errorMessage, errorCode }) {
    const token = await authRepository.findLatestActiveAuthToken({ target, type, userId });
    if (!token) {
      throw new AppError(errorMessage, 400, errorCode);
    }

    if (!isSameHash(token.tokenHash, hashToken(String(code)))) {
      const attempts = (token.attempts || 0) + 1;
      await authRepository.recordFailedAttempt(token._id, {
        invalidate: attempts >= OTP_CONFIG.MAX_ATTEMPTS,
      });
      throw new AppError(errorMessage, 400, errorCode);
    }

    await authRepository.markAuthTokenUsed(token._id);
    return token;
  }

  /**
   * Create user + parent profile + free subscription.
   * MongoDB transactions need a replica set (not available in the test server), so a failure
   * after the user is created is compensated by deleting what was already written.
   */
  async _createParentAccount({ userData, parentData }) {
    let user = null;
    let parent = null;

    try {
      user = await userService.createUser({
        ...userData,
        role: USER_ROLES.PARENT,
        isActive: true,
      });

      parent = await parentService.createParentProfile({
        ...parentData,
        userId: user._id,
      });

      await subscriptionService.createFreeSubscription(parent._id);

      return { user, parent };
    } catch (error) {
      if (parent) {
        await parentService.deleteParentByUserId(user._id).catch(() => {});
      }
      if (user) {
        await userService.deleteUserById(user._id).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Validate email/password credentials and return the active user
   */
  async _authenticateWithPassword({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await userService.getUserByEmail(normalizedEmail);

    if (!user || !user.passwordHash) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('User account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    return user;
  }

  /**
   * Issue a session for an authenticated user and build the login response
   */
  async _buildLoginResult(user) {
    const parent = user.role === USER_ROLES.PARENT
      ? await parentService.getParentByUserId(user._id)
      : null;

    const tokens = await this._generateTokenPair(user);

    return {
      dto: AuthResponseDTO.toResponse({ user, parent, tokens }),
      tokens,
    };
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

    const { user, parent } = await this._createParentAccount({
      userData: {
        email: normalizedEmail,
        phone: trimmedPhone || undefined,
        passwordHash,
      },
      parentData: {
        fullName: fullName.trim(),
        verification: {
          isEmailVerified: false,
          isPhoneVerified: false,
          isVerifiedParent: false,
        },
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

    // Only a Google-verified email proves ownership of the address we link or create
    if (!googleUser.isEmailVerified) {
      throw new AppError('Google account email is not verified', 401, 'GOOGLE_EMAIL_NOT_VERIFIED');
    }

    const normalizedEmail = googleUser.email.toLowerCase().trim();

    let user = await userService.getUserByEmail(normalizedEmail);
    let parent = null;

    if (!user) {
      ({ user, parent } = await this._createParentAccount({
        userData: {
          email: normalizedEmail,
          googleId: googleUser.googleId,
          passwordHash: null,
        },
        parentData: {
          fullName: googleUser.fullName,
          avatarUrl: googleUser.avatarUrl,
          verification: {
            isEmailVerified: true, // Google email is already verified
            isPhoneVerified: false,
            isVerifiedParent: false,
          },
        },
      }));
    } else {
      if (!user.isActive) {
        throw new AppError('User account is disabled', 403, 'ACCOUNT_DISABLED');
      }

      parent = await parentService.getParentByUserId(user._id);

      // Link Google to an existing local account
      if (!user.googleId) {
        const linkUpdate = { googleId: googleUser.googleId };

        // If the local account never verified its email, its password may have been set by
        // someone else who registered this address first (account pre-hijacking).
        // Google proves ownership now, so drop that password and its sessions.
        const isLocalEmailUnverified = parent && !parent.verification?.isEmailVerified;
        if (isLocalEmailUnverified && user.passwordHash) {
          linkUpdate.passwordHash = null;
          await authRepository.revokeAllUserRefreshTokens(user._id);
        }

        user = await userService.updateById(user._id, linkUpdate);
      }

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
    const user = await this._authenticateWithPassword({ email, password });
    return this._buildLoginResult(user);
  }

  /**
   * Admin Login: the role is checked before any session is created
   */
  async loginAdmin({ email, password }) {
    const user = await this._authenticateWithPassword({ email, password });
    if (user.role !== USER_ROLES.ADMIN) {
      throw new AppError('Access denied: Admin privileges required', 403, 'FORBIDDEN');
    }
    return this._buildLoginResult(user);
  }

  /**
   * Send Phone OTP
   */
  async sendPhoneOtp(userId, phone) {
    const existingUser = await userService.getUserByPhone(phone);
    if (existingUser && existingUser._id.toString() !== userId.toString()) {
      throw new AppError('Phone number is already associated with another account', 409, 'PHONE_IN_USE');
    }

    const otp = await this._issueOtp({
      userId,
      target: phone,
      type: TOKEN_TYPES.PHONE_OTP,
      expiresInMinutes: OTP_CONFIG.EXPIRES_IN_MINUTES,
    });

    await smsAdapter.sendPhoneOtp({
      phone,
      otp,
      minutes: OTP_CONFIG.EXPIRES_IN_MINUTES,
    });

    return { message: 'Phone OTP sent successfully' };
  }

  /**
   * Verify Phone OTP (the code must have been issued to this user)
   */
  async verifyPhoneOtp(userId, phone, otp) {
    await this._consumeOtp({
      userId,
      target: phone,
      type: TOKEN_TYPES.PHONE_OTP,
      code: otp,
      errorMessage: 'Invalid or expired OTP code',
      errorCode: 'INVALID_OTP',
    });

    // Update phone on User
    await userService.updatePhone(userId, phone);

    // Update verification on Parent
    const parent = await parentService.updateVerification(userId, { isPhoneVerified: true });
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

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
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

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

    const otp = await this._issueOtp({
      userId,
      target: user.email,
      type: TOKEN_TYPES.EMAIL_VERIFY,
      expiresInMinutes: OTP_CONFIG.EMAIL_EXPIRES_IN_MINUTES,
    });

    const mailResult = await mailAdapter.sendEmailOtp({
      to: user.email,
      otp,
      fullName: parent?.fullName || 'Parent',
      minutes: OTP_CONFIG.EMAIL_EXPIRES_IN_MINUTES,
    });

    if (!mailResult?.success) {
      throw new AppError('Unable to send the verification email. Please try again later.', 502, 'EMAIL_SEND_FAILED');
    }

    return { message: 'Email verification code sent successfully' };
  }

  /**
   * Verify Email OTP (the code must have been issued to this user)
   */
  async verifyEmailOtp(userId, otp) {
    const user = await userService.getUserById(userId);

    await this._consumeOtp({
      userId,
      target: user.email,
      type: TOKEN_TYPES.EMAIL_VERIFY,
      code: otp,
      errorMessage: 'Invalid or expired verification code',
      errorCode: 'INVALID_OTP',
    });

    const parent = await parentService.updateVerification(userId, { isEmailVerified: true });
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

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

    const resetOtp = await this._issueOtp({
      userId: user._id,
      target: normalizedEmail,
      type: TOKEN_TYPES.PASSWORD_RESET,
      expiresInMinutes: OTP_CONFIG.PASSWORD_RESET_EXPIRES_IN_MINUTES,
    });

    const parent = await parentService.getParentByUserId(user._id);

    await mailAdapter.sendPasswordResetEmail({
      to: normalizedEmail,
      token: resetOtp,
      fullName: parent?.fullName || 'User',
      minutes: OTP_CONFIG.PASSWORD_RESET_EXPIRES_IN_MINUTES,
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

    await this._consumeOtp({
      userId: user._id,
      target: normalizedEmail,
      type: TOKEN_TYPES.PASSWORD_RESET,
      code: token,
      errorMessage: 'Invalid or expired reset token',
      errorCode: 'INVALID_RESET_TOKEN',
    });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await userService.updatePassword(user._id, passwordHash);

    // Revoke all existing sessions for security
    await authRepository.revokeAllUserRefreshTokens(user._id);

    return { message: 'Password has been successfully reset' };
  }

  /**
   * Revoke every session of a user (e.g. after a password change) and issue a fresh pair
   * so the device that made the change stays signed in.
   */
  async rotateAllSessions(userId) {
    const user = await userService.getUserById(userId);
    await authRepository.revokeAllUserRefreshTokens(user._id);
    return this._generateTokenPair(user);
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
