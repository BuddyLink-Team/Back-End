import { OAuth2Client } from 'google-auth-library';
import env from '../../config/env.js';
import AppError from '../../shared/exceptions/app-error.js';
import { GoogleUserInfoDTO } from '../../modules/auth/auth.dto.js';

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const USERINFO_TIMEOUT_MS = 10000;

// Test mode: "mock-google-token:<email>:<name>[:unverified]" stands for a Google account
const mockPayload = (token) => {
  const parts = token.split(':');
  return {
    sub: `google-id-${Date.now()}`,
    email: parts[1] || 'googleuser@test.com',
    name: parts[2] || 'Google User',
    picture: 'https://lh3.googleusercontent.com/a/default-user',
    email_verified: parts[3] !== 'unverified',
  };
};
const isMockToken = (token) => process.env.NODE_ENV === 'test' && String(token).startsWith('mock-google-token:');

class GoogleAuthAdapter {
  constructor() {
    this.client = new OAuth2Client(env.GOOGLE.CLIENT_ID);
  }

  async verifyIdToken(idToken) {
    if (!idToken) {
      throw new AppError('Google ID token is required', 400, 'INVALID_GOOGLE_TOKEN');
    }

    if (isMockToken(idToken)) return GoogleUserInfoDTO.fromPayload(mockPayload(idToken));

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new AppError('Failed to extract payload from Google token', 401, 'INVALID_GOOGLE_TOKEN');
      }

      return GoogleUserInfoDTO.fromPayload(payload);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Google verification failed: ${error.message}`, 401, 'INVALID_GOOGLE_TOKEN');
    }
  }

  /**
   * OAuth access token of the Google popup (the web app's own button): it must have been issued to this
   * app's client id (a token of another app is refused), then the account is read from Google's userinfo
   * @param {string} accessToken
   * @returns {Promise<Object>} GoogleUserInfoDTO
   */
  async verifyAccessToken(accessToken) {
    if (!accessToken) {
      throw new AppError('Google access token is required', 400, 'INVALID_GOOGLE_TOKEN');
    }
    if (isMockToken(accessToken)) return GoogleUserInfoDTO.fromPayload(mockPayload(accessToken));

    const clientId = env.GOOGLE.CLIENT_ID;
    let tokenInfo;
    try {
      tokenInfo = await this.client.getTokenInfo(accessToken);
    } catch (error) {
      throw new AppError(`Google verification failed: ${error.message}`, 401, 'INVALID_GOOGLE_TOKEN');
    }
    if (!clientId || (tokenInfo.aud !== clientId && tokenInfo.azp !== clientId)) {
      throw new AppError('Google token was not issued for this app', 401, 'INVALID_GOOGLE_TOKEN');
    }

    let profile;
    try {
      const response = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`userinfo ${response.status}`);
      profile = await response.json();
    } catch (error) {
      throw new AppError(`Google verification failed: ${error.message}`, 401, 'INVALID_GOOGLE_TOKEN');
    }
    // The account of the token is the one described
    if (!profile?.sub || (tokenInfo.sub && profile.sub !== tokenInfo.sub)) {
      throw new AppError('Failed to read the Google account', 401, 'INVALID_GOOGLE_TOKEN');
    }
    return GoogleUserInfoDTO.fromPayload(profile);
  }
}

export default new GoogleAuthAdapter();
