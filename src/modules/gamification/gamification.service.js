import Parent from '../parent/parent.model.js';
import Playdate from '../playdate/playdate.model.js';
import Connection from '../connection/connection.model.js';
import gamificationRepository from './gamification.repository.js';
import AppError from '../../shared/exceptions/AppError.js';
import { BADGE_DEFINITIONS, calculateStreak, completedParticipation, locationKey } from './gamification.rules.js';

export async function getParent(userId) {
  const parent = await Parent.findOne({ userId });
  if (!parent) throw new AppError('Không tìm thấy hồ sơ phụ huynh.', 404, 'PARENT_NOT_FOUND');
  return parent;
}

export async function seedBadges() {
  await gamificationRepository.bulkUpsertBadges(BADGE_DEFINITIONS);
}

export async function syncParentAchievements(parentId, now = new Date()) {
  const [playdates, connections] = await Promise.all([
    Playdate.find(completedParticipation(parentId)).select('completedAt scheduledDate location').lean(),
    Connection.find({ parents: parentId, status: 'accepted' }).select('parents').lean(),
  ]);
  const streak = calculateStreak(playdates.map(p => p.completedAt || p.scheduledDate), now);
  // Never reduce the best recorded streak when historical records change.
  const { longestStreak, ...current } = streak;
  const parent = await Parent.findByIdAndUpdate(parentId, {
    $set: Object.fromEntries(Object.entries(current).map(([key, value]) => [`streak.${key}`, value])),
    $max: { 'streak.longestStreak': longestStreak },
  }, { new: true });
  if (!parent) throw new AppError('Không tìm thấy hồ sơ phụ huynh.', 404, 'PARENT_NOT_FOUND');
  const metrics = {
    connections: new Set(connections.flatMap(c => c.parents.map(String)).filter(id => id !== String(parentId))).size,
    playdates: playdates.length,
    places: new Set(playdates.map(p => locationKey(p.location)).filter(Boolean)).size,
    longestStreak: parent.streak.longestStreak,
  };
  for (const badge of BADGE_DEFINITIONS) {
    if (metrics[badge.metric] < badge.requirementCount) continue;
    try {
      await gamificationRepository.unlockUserBadge(parentId, badge.code, now);
    } catch (error) {
      // Concurrent cron / HTTP evaluations can only unlock once.
      if (error.code !== 11000) throw error;
    }
  }
  const unlocked = await gamificationRepository.findUserBadgesByParentId(parentId);
  return {
    streak: {
      currentWeeklyStreak: parent.streak.currentWeeklyStreak,
      longestStreak: parent.streak.longestStreak,
      lastCompletedPlaydateWeek: parent.streak.lastCompletedPlaydateWeek,
      streakUpdatedAt: parent.streak.streakUpdatedAt,
    },
    badges: BADGE_DEFINITIONS.map(({ metric, ...badge }) => {
      const earned = unlocked.find(item => item.badgeCode === badge.code);
      return { ...badge, unlocked: Boolean(earned), unlockedAt: earned?.unlockedAt || null };
    }),
  };
}

export async function getMyAchievements(userId) {
  const parent = await getParent(userId);
  return syncParentAchievements(parent._id);
}

export async function reconcileAchievements() {
  for await (const parent of Parent.find().select('_id').cursor()) {
    await syncParentAchievements(parent._id);
  }
}
