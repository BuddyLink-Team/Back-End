import { USER_ROLES } from '../../shared/constants/index.js';

/**
 * Data Transfer Objects for Authentication Module
 */

export class AuthResponseDTO {
  static toResponse({ user, parent, tokens }) {
    return {
      user: {
        id: user._id?.toString() || user.id,
        email: user.email,
        phone: user.phone || null,
        role: user.role || USER_ROLES.PARENT,
      },
      parent: parent
        ? {
            id: parent._id?.toString() || parent.id,
            fullName: parent.fullName,
            avatarUrl: parent.avatarUrl || '',
            verification: {
              isEmailVerified: Boolean(parent.verification?.isEmailVerified),
              isPhoneVerified: Boolean(parent.verification?.isPhoneVerified),
              isVerifiedParent: Boolean(parent.verification?.isVerifiedParent),
            },
          }
        : null,
      tokens: tokens
        ? {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          }
        : undefined,
    };
  }
}

export class AuthUserDTO {
  static toResponse({ user, parent }) {
    return {
      user: {
        id: user._id?.toString() || user.id,
        email: user.email,
        phone: user.phone || null,
        role: user.role || USER_ROLES.PARENT,
        isActive: user.isActive,
      },
      parent: parent
        ? {
            id: parent._id?.toString() || parent.id,
            fullName: parent.fullName,
            avatarUrl: parent.avatarUrl || '',
            bio: parent.bio || '',
            location: parent.location || {},
            preferences: parent.preferences || {},
            privacySettings: parent.privacySettings || {},
            verification: {
              isEmailVerified: Boolean(parent.verification?.isEmailVerified),
              isPhoneVerified: Boolean(parent.verification?.isPhoneVerified),
              isVerifiedParent: Boolean(parent.verification?.isVerifiedParent),
            },
          }
        : null,
    };
  }
}

export class TokenPairDTO {
  static toResponse({ accessToken, refreshToken }) {
    return {
      accessToken,
      refreshToken,
    };
  }
}

export class VerificationStatusDTO {
  static toResponse({ isEmailVerified, isPhoneVerified, isVerifiedParent }) {
    return {
      isEmailVerified: Boolean(isEmailVerified),
      isPhoneVerified: Boolean(isPhoneVerified),
      isVerifiedParent: Boolean(isVerifiedParent),
    };
  }
}

export class TokenPayloadDTO {
  static fromUser(user) {
    return {
      userId: user._id?.toString() || user.id,
      role: user.role,
    };
  }
}

export class GoogleUserInfoDTO {
  static fromPayload(payload) {
    return {
      googleId: payload.sub,
      email: payload.email,
      fullName: payload.name || payload.given_name || 'Parent',
      avatarUrl: payload.picture || '',
      isEmailVerified: Boolean(payload.email_verified),
    };
  }
}
