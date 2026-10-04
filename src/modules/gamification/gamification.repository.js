import Badge from './badge.model.js';
import UserBadge from './user-badge.model.js';

class GamificationRepository {
  async bulkUpsertBadges(definitions) {
    return Badge.bulkWrite(
      definitions.map(({ metric, ...definition }) => ({
        updateOne: {
          filter: { code: definition.code },
          update: { $setOnInsert: definition },
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
