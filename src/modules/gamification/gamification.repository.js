import Badge from './badge.model.js';
import UserBadge from './user-badge.model.js';

class GamificationRepository {
  /**
   * Create missing badges and keep existing ones in sync with the code definitions
   * (title, description, icon and requirement changes reach the database on the next start).
   * @param {Array<Object>} definitions - BADGE_DEFINITIONS
   */
  async bulkUpsertBadges(definitions) {
    return Badge.bulkWrite(
      definitions.map(({ code, title, description, iconUrl, requirementCount }) => ({
        updateOne: {
          filter: { code },
          update: { $set: { title, description, iconUrl, requirementCount }, $setOnInsert: { code } },
          upsert: true,
        },
      }))
    );
  }

  /**
   * @returns {Promise<Map<string, ObjectId>>} badge _id by badge code
   */
  async findBadgeIdsByCode() {
    const badges = await Badge.find({}, { code: 1 }).lean();
    return new Map(badges.map((badge) => [badge.code, badge._id]));
  }

  /**
   * user_badges of a parent, with the code of each badge (badgeId populated)
   */
  async findUserBadgesByParentId(parentId) {
    return UserBadge.find({ parentId }).populate('badgeId', 'code').lean();
  }

  async unlockUserBadge(parentId, badgeId, unlockedAt) {
    return UserBadge.updateOne(
      { parentId, badgeId },
      { $setOnInsert: { parentId, badgeId, unlockedAt } },
      { upsert: true }
    );
  }
}

export default new GamificationRepository();
