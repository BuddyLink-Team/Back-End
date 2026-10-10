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

  async findUserBadgesByParentId(parentId) {
    return UserBadge.find({ parentId }).lean();
  }

  async unlockUserBadge(parentId, badgeCode, unlockedAt) {
    return UserBadge.updateOne(
      { parentId, badgeCode },
      { $setOnInsert: { parentId, badgeCode, unlockedAt } },
      { upsert: true }
    );
  }
}

export default new GamificationRepository();
