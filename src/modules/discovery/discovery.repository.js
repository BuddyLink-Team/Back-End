import Parent from '../parent/parent.model.js';
import Swipe from './discovery.model.js';
import mongoose from 'mongoose';
import { CONNECTION_PRIVACY } from '../parent/parent.constants.js';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class DiscoveryRepository {
  /**
   * Find nearby parent profiles using $geoNear aggregation, then lookup their children.
   * Excludes hidden profiles, parents who accept no connections, disabled accounts,
   * specific parent IDs, and already-swiped children.
   * Applies optional age and interest filters on children.
   *
   * @param {[number, number]} coordinates - [longitude, latitude]
   * @param {number} maxDistanceMeters - Maximum search radius in meters
   * @param {string[]} excludeParentIds - Parent IDs to exclude (self, blocked)
   * @param {string[]} excludeChildIds - Child IDs already swiped
   * @param {Object} filters - Optional filters { ageMin, ageMax, interests }
   * @param {number} limit - Max number of candidates
   * @returns {Promise<Array<{parent, child, distanceKm}>>}
   */
  async findNearbyProfiles(
    coordinates,
    maxDistanceMeters,
    excludeParentIds,
    excludeChildIds,
    filters = {},
    limit = 20
  ) {
    const excludeParentObjectIds = excludeParentIds.map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    const excludeChildObjectIds = excludeChildIds.map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    // Build child match conditions
    const childMatchConditions = {
      'children._id': { $nin: excludeChildObjectIds },
      'children.isArchived': false,
    };

    // Age filter: convert age range to dateOfBirth range
    if (filters.ageMin !== undefined || filters.ageMax !== undefined) {
      const now = new Date();
      const dateOfBirth = {};

      if (filters.ageMax !== undefined) {
        // ageMax → child must be born AFTER this date (younger bound)
        dateOfBirth.$gt = new Date(
          now.getFullYear() - filters.ageMax - 1,
          now.getMonth(),
          now.getDate()
        );
      }

      if (filters.ageMin !== undefined) {
        // ageMin → child must be born ON or BEFORE this date (older bound)
        dateOfBirth.$lte = new Date(
          now.getFullYear() - filters.ageMin,
          now.getMonth(),
          now.getDate()
        );
      }

      childMatchConditions['children.dateOfBirth'] = dateOfBirth;
    }

    // Interest filter: case-insensitive, matches either interests or favorite activities
    if (filters.interests && filters.interests.length > 0) {
      const interestPatterns = filters.interests.map(
        (interest) => new RegExp(`^${escapeRegExp(interest)}$`, 'i')
      );
      childMatchConditions.$or = [
        { 'children.interests': { $in: interestPatterns } },
        { 'children.favoriteActivities': { $in: interestPatterns } },
      ];
    }

    const pipeline = [
      // Stage 1: GeoNear — find visible parents within radius
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates,
          },
          distanceField: 'distanceMeters',
          maxDistance: maxDistanceMeters,
          spherical: true,
          query: {
            _id: { $nin: excludeParentObjectIds },
            'privacySettings.isProfileHidden': { $ne: true },
            'privacySettings.connectionPrivacy': { $ne: CONNECTION_PRIVACY.NOBODY },
          },
        },
      },

      // Stage 2: Exclude parents whose user account is disabled
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $match: { 'user.isActive': true } },

      // Stage 3: Lookup children belonging to each nearby parent
      {
        $lookup: {
          from: 'children',
          localField: '_id',
          foreignField: 'parentId',
          as: 'children',
        },
      },

      // Stage 4: Unwind children (one document per child)
      { $unwind: '$children' },

      // Stage 5: Filter children (exclude swiped, archived, apply age/interest filters)
      { $match: childMatchConditions },

      // Stage 6: Project the fields we need
      {
        $project: {
          parent: {
            _id: '$_id',
            userId: '$userId',
            fullName: '$fullName',
            avatarUrl: '$avatarUrl',
            bio: '$bio',
            location: '$location',
            preferences: '$preferences',
            verification: '$verification',
          },
          child: '$children',
          distanceKm: { $divide: ['$distanceMeters', 1000] },
        },
      },

      // Stage 7: Limit candidate pool (scoring and final cut happen in the service)
      { $limit: limit },
    ];

    return Parent.aggregate(pipeline);
  }

  /**
   * Get all child IDs that a parent has already swiped on
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @returns {Promise<string[]>}
   */
  async getSwipedChildIds(swiperParentId) {
    const swipes = await Swipe.find({ swiperParentId }).select('targetChildId');
    return swipes.map((s) => s.targetChildId.toString());
  }

  /**
   * Create a new swipe record (Like or Pass)
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId} targetChildId
   * @param {string|mongoose.Types.ObjectId} targetParentId
   * @param {boolean} isLike
   * @returns {Promise<Object>}
   */
  async createSwipe(swiperParentId, targetChildId, targetParentId, isLike) {
    return Swipe.create({
      swiperParentId,
      targetChildId,
      targetParentId,
      isLike,
    });
  }

  /**
   * Check if a swipe already exists for a specific child
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId} targetChildId
   * @returns {Promise<Object|null>}
   */
  async findExistingSwipe(swiperParentId, targetChildId) {
    return Swipe.findOne({ swiperParentId, targetChildId });
  }
}

export default new DiscoveryRepository();
