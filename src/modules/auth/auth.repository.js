import AuthToken from './auth-token.model.js';
import RefreshToken from './refresh-token.model.js';

class AuthRepository {
  async createAuthToken({ userId, target, tokenHash, type, expiresAt }) {
    return AuthToken.create({
      userId,
      target,
      tokenHash,
      type,
      expiresAt,
    });
  }

  async findValidAuthToken({ target, tokenHash, type }) {
    return AuthToken.findOne({
      target,
      tokenHash,
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });
  }

  async markAuthTokenUsed(id) {
    return AuthToken.findByIdAndUpdate(id, { $set: { isUsed: true } }, { new: true });
  }

  async createRefreshToken({ userId, tokenHash, expiresAt }) {
    return RefreshToken.create({
      userId,
      tokenHash,
      expiresAt,
    });
  }

  async findRefreshTokenByHash(tokenHash) {
    return RefreshToken.findOne({ tokenHash });
  }

  async revokeRefreshToken(tokenHash) {
    return RefreshToken.findOneAndUpdate(
      { tokenHash },
      { $set: { isRevoked: true, revokedAt: new Date() } },
      { new: true }
    );
  }

  async revokeAllUserRefreshTokens(userId) {
    return RefreshToken.updateMany(
      { userId, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date() } }
    );
  }
}

export default new AuthRepository();
