import mongoose from 'mongoose';
import Parent from './parent.model.js';
import { CONNECTION_PRIVACY } from './parent.constants.js';

class ParentRepository {
  async findByUserId(userId) {
    return Parent.findOne({ userId });
  }

  async findById(id) {
    return Parent.findById(id);
  }

  /**
   * Find parents near a point, nearest first, excluding hidden profiles and parents
   * that accept no connection requests.
   * @param {[number, number]} coordinates - [longitude, latitude]
   * @param {number} maxDistanceMeters
   * @param {Array<string|ObjectId>} excludeParentIds
   * @param {number} limit
   * @returns {Promise<Array<Object>>} Parents with a `distanceKm` field
   */
  async findNearbyVisible(coordinates, maxDistanceMeters, excludeParentIds, limit) {
    return Parent.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates },
          distanceField: 'distanceMeters',
          maxDistance: maxDistanceMeters,
          spherical: true,
          query: {
            _id: { $nin: excludeParentIds.map((id) => new mongoose.Types.ObjectId(id)) },
            'privacySettings.isProfileHidden': { $ne: true },
            'privacySettings.connectionPrivacy': { $ne: CONNECTION_PRIVACY.NOBODY },
          },
        },
      },
      { $limit: limit },
      {
        $project: {
          userId: 1,
          fullName: 1,
          avatarUrl: 1,
          bio: 1,
          location: 1,
          preferences: 1,
          verification: 1,
          distanceKm: { $divide: ['$distanceMeters', 1000] },
        },
      },
    ]);
  }

  async create(parentData) {
    return Parent.create(parentData);
  }

  async updateByUserId(userId, updateData) {
    return Parent.findOneAndUpdate(
      { userId },
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async deleteByUserId(userId) {
    return Parent.deleteOne({ userId });
  }

  /**
   * Save the weekly streak; the longest streak never decreases
   * @param {string|ObjectId} parentId
   * @param {{ currentWeeklyStreak: number, lastCompletedPlaydateWeek: string|null, streakUpdatedAt: Date }} current
   * @param {number} longestStreak
   * @returns {Promise<Object|null>}
   */
  async updateStreak(parentId, current, longestStreak) {
    return Parent.findByIdAndUpdate(
      parentId,
      {
        $set: Object.fromEntries(Object.entries(current).map(([key, value]) => [`streak.${key}`, value])),
        $max: { 'streak.longestStreak': longestStreak },
      },
      { new: true }
    ).lean();
  }

  /**
   * Stream the IDs of every parent (for batch jobs)
   * @returns {import('mongoose').Cursor}
   */
  findAllIdsCursor() {
    return Parent.find().select('_id').lean().cursor();
  }

  async updateVerification(userId, verificationUpdates) {
    const parent = await Parent.findOne({ userId });
    if (!parent) return null;

    const currentVerification = parent.verification || {};
    const newVerification = {
      ...currentVerification,
      ...verificationUpdates,
    };

    if (newVerification.isEmailVerified && newVerification.isPhoneVerified) {
      newVerification.isVerifiedParent = true;
    }

    parent.verification = newVerification;
    return parent.save();
  }
}

export default new ParentRepository();
