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

  /**
   * Invalidate every still-usable code of this target/type so only the newest one works
   */
  async invalidateActiveAuthTokens({ target, type }) {
    return AuthToken.updateMany(
      { target, type, isUsed: false },
      { $set: { isUsed: true } }
    );
  }

  /**
   * Latest usable code issued for a target/type, optionally bound to a user
   */
  async findLatestActiveAuthToken({ target, type, userId }) {
    return AuthToken.findOne({
      target,
      type,
      isUsed: false,
      expiresAt: { $gt: new Date() },
      ...(userId ? { userId } : {}),
    }).sort({ createdAt: -1 });
  }

  /**
   * Record a wrong code; invalidate the token once the attempt limit is reached
   */
  async recordFailedAttempt(id, { invalidate }) {
    return AuthToken.findByIdAndUpdate(
      id,
      {
        $inc: { attempts: 1 },
        ...(invalidate ? { $set: { isUsed: true } } : {}),
      },
      { new: true }
    );
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

  /**
   * Count distinct users who held a valid or active refresh session within a timeframe
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Promise<number>}
   */
  async countActiveUserIdsBetween(fromDate, toDate) {
    const filter = {};
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate) filter.createdAt.$lte = toDate;
    }
    const distinctUsers = await RefreshToken.distinct('userId', filter);
    return distinctUsers.length;
  }
}

export default new AuthRepository();
