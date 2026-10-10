import gamificationRepository from './gamification.repository.js';
import parentService from '../parent/parent.service.js';
import playdateService from '../playdate/playdate.service.js';
import connectionService from '../connection/connection.service.js';
import notificationService from '../notification/notification.service.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/AppError.js';
import { AchievementsDTO } from './gamification.dto.js';
import { BADGE_DEFINITIONS } from './gamification.constants.js';
import { buildMetrics, calculateStreak, weekKey, weekStart } from './gamification.rules.js';

class GamificationService {
  /**
   * Make sure every badge definition exists in the `badges` collection
   */
  async seedBadges() {
    await gamificationRepository.bulkUpsertBadges(BADGE_DEFINITIONS);
  }

  /**
   * Recalculate the weekly streak and unlock newly earned badges of a parent.
   * Badges are permanent: they are never removed when the metrics decrease later.
   * @param {string|ObjectId} parentId
   * @param {Date} [now]
   * @returns {Promise<Object>} AchievementsDTO
   */
  async syncParentAchievements(parentId, now = new Date()) {
    const [playdates, connectionCount] = await Promise.all([
      playdateService.getCompletedPlaydatesForParent(parentId, {
        select: 'completedAt scheduledDate location hostParentId',
      }),
      connectionService.countAcceptedConnections(parentId),
    ]);

    const { longestStreak, ...current } = calculateStreak(
      playdates.map((p) => p.completedAt || p.scheduledDate),
      now
    );
    // The repository keeps the best recorded streak when historical records change
    const parent = await parentService.updateStreak(parentId, current, longestStreak);
    if (!parent) throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');

    const metrics = buildMetrics({
      parentId,
      playdates,
      connectionCount,
      longestStreak: parent.streak.longestStreak,
    });
    const newlyUnlocked = [];
    for (const badge of BADGE_DEFINITIONS) {
      if (metrics[badge.metric] < badge.requirementCount) continue;
      try {
        const result = await gamificationRepository.unlockUserBadge(parentId, badge.code, now);
        if (result?.upsertedCount) newlyUnlocked.push(badge);
      } catch (error) {
        // Concurrent job / HTTP evaluations can only unlock once
        if (error.code !== 11000) throw error;
      }
    }
    await this._notifyBadgesUnlocked(parent.userId, newlyUnlocked);

    const unlocked = await gamificationRepository.findUserBadgesByParentId(parentId);
    return AchievementsDTO.toResponse(parent.streak, BADGE_DEFINITIONS, unlocked, {
      metrics,
      currentWeek: weekKey(weekStart(now)),
    });
  }

  /**
   * Send a badge_unlocked notification per new badge. A failure is only logged: the badge stays unlocked.
   * @private
   */
  async _notifyBadgesUnlocked(userId, badges) {
    for (const badge of badges) {
      try {
        await notificationService.notifyBadgeUnlocked(userId, badge);
      } catch (error) {
        logger.error(`[Gamification] badge_unlocked notification failed (${badge.code}): ${error.message}`);
      }
    }
  }

  /**
   * Streak and badges of the authenticated parent (recalculated on read)
   * @param {string} userId
   */
  async getMyAchievements(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    return this.syncParentAchievements(parent._id);
  }

  /**
   * Recalculate every parent (weekly job: resets streaks that missed a full week)
   */
  async reconcileAchievements() {
    for await (const parentId of parentService.iterateParentIds()) {
      await this.syncParentAchievements(parentId);
    }
  }
}

export const gamificationService = new GamificationService();
export default gamificationService;
