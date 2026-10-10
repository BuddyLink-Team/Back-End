/**
 * Data Transfer Objects for Gamification Module
 */

export class AchievementsDTO {
  /**
   * @param {Object} streak - parents.streak
   * @param {Array<Object>} definitions - BADGE_DEFINITIONS
   * @param {Array<Object>} unlockedBadges - user_badges of the parent
   * @param {{ metrics?: Object, currentWeek?: string }} [context] - Current badge metrics and ISO week key
   */
  static toResponse(streak = {}, definitions = [], unlockedBadges = [], { metrics = {}, currentWeek = null } = {}) {
    const unlockedByCode = new Map(unlockedBadges.map((item) => [item.badgeCode, item]));
    const lastCompletedPlaydateWeek = streak.lastCompletedPlaydateWeek ?? null;

    return {
      streak: {
        currentWeeklyStreak: streak.currentWeeklyStreak ?? 0,
        longestStreak: streak.longestStreak ?? 0,
        lastCompletedPlaydateWeek,
        isCurrentWeekCompleted: Boolean(currentWeek) && lastCompletedPlaydateWeek === currentWeek,
        streakUpdatedAt: streak.streakUpdatedAt ?? null,
      },
      badges: definitions.map(({ code, title, description, iconUrl, requirementCount, metric }) => {
        const earned = unlockedByCode.get(code);
        return {
          code,
          title,
          description,
          iconUrl: iconUrl || null,
          requirementCount,
          // Current value toward the requirement (capped); a permanent badge stays complete
          progress: earned ? requirementCount : Math.min(metrics[metric] ?? 0, requirementCount),
          unlocked: Boolean(earned),
          unlockedAt: earned?.unlockedAt || null,
        };
      }),
    };
  }
}
