import { OAuth2Client } from 'google-auth-library';
import env from '../../config/env.js';
import AppError from '../../shared/exceptions/AppError.js';
import { GoogleUserInfoDTO } from '../../modules/auth/auth.dto.js';

class GoogleAuthAdapter {
  constructor() {
    this.client = new OAuth2Client(env.GOOGLE.CLIENT_ID);
  }

  async verifyIdToken(idToken) {
    if (!idToken) {
      throw new AppError('Google ID token is required', 400, 'INVALID_GOOGLE_TOKEN');
    }

    // Support mock idToken for integration testing: "mock-google-token:<email>:<name>"
    if (process.env.NODE_ENV === 'test' && idToken.startsWith('mock-google-token:')) {
      const parts = idToken.split(':');
      const email = parts[1] || 'googleuser@test.com';
      const name = parts[2] || 'Google User';

      return GoogleUserInfoDTO.fromPayload({
        sub: `google-id-${Date.now()}`,
        email,
        name,
        picture: 'https://lh3.googleusercontent.com/a/default-user',
        email_verified: true,
      });
    }

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
}

export default new GoogleAuthAdapter();
