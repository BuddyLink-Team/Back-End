import mongoose from 'mongoose';
import Child from './child.model.js';
import { escapeRegExp } from '../../shared/helpers/regex.helper.js';


class ChildRepository {
  async create(childData, session = null) {
    if (session) {
      const created = await Child.create([childData], { session });
      return created[0];
    }
    return Child.create(childData);
  }

  async findByIdAndParentId(id, parentId) {
    return Child.findOne({ _id: id, parentId, isArchived: false });
  }

  async findActiveById(id) {
    return Child.findOne({ _id: id, isArchived: false });
  }

  /**
   * Active children of the given parents, for discovery.
   * @param {Object} criteria
   * @param {Array<string|ObjectId>} criteria.parentIds
   * @param {Array<string|ObjectId>} [criteria.excludeChildIds] - Already swiped children
   * @param {number} [criteria.ageMin]
   * @param {number} [criteria.ageMax]
   * @param {string[]} [criteria.interests] - Case-insensitive, matches interests or favorite activities
   * @returns {Promise<Array<Object>>}
   */
  async findDiscoverable({ parentIds, excludeChildIds = [], ageMin, ageMax, interests = [] }) {
    const query = {
      parentId: { $in: parentIds.map((id) => new mongoose.Types.ObjectId(id)) },
      _id: { $nin: excludeChildIds.map((id) => new mongoose.Types.ObjectId(id)) },
      isArchived: false,
    };

    // Age range → dateOfBirth range
    if (ageMin !== undefined || ageMax !== undefined) {
      const now = new Date();
      query.dateOfBirth = {};
      if (ageMax !== undefined) {
        // ageMax → child must be born AFTER this date (younger bound)
        query.dateOfBirth.$gt = new Date(now.getFullYear() - ageMax - 1, now.getMonth(), now.getDate());
      }
      if (ageMin !== undefined) {
        // ageMin → child must be born ON or BEFORE this date (older bound)
        query.dateOfBirth.$lte = new Date(now.getFullYear() - ageMin, now.getMonth(), now.getDate());
      }
    }

    if (interests.length > 0) {
      const patterns = interests.map((interest) => new RegExp(`^${escapeRegExp(interest)}$`, 'i'));
      query.$or = [{ interests: { $in: patterns } }, { favoriteActivities: { $in: patterns } }];
    }

    return Child.find(query).lean();
  }

  async findByParentId(parentId, session = null) {
    const query = Child.find({ parentId, isArchived: false }).sort({ createdAt: -1 });
    if (session) query.session(session);
    return query;
  }

  async updateById(id, parentId, updateData, session = null) {
    const options = { new: true };
    if (session) options.session = session;
    return Child.findOneAndUpdate(
      { _id: id, parentId, isArchived: false },
      { $set: updateData },
      { ...options, runValidators: true }
    );
  }

  async softDeleteById(id, parentId, session = null) {
    const options = { new: true };
    if (session) options.session = session;
    return Child.findOneAndUpdate(
      { _id: id, parentId, isArchived: false },
      { $set: { isArchived: true } },
      options
    );
  }

  async countByParentId(parentId, session = null) {
    const query = Child.countDocuments({ parentId, isArchived: false });
    if (session) query.session(session);
    return query;
  }

  /**
   * Find a child by ID and populate parent info for public profile view
   */
  async findByIdWithParent(childId) {
    return Child.findOne({ _id: childId, isArchived: false })
      .populate({
        path: 'parentId',
        select: 'fullName avatarUrl bio location.area location.city verification preferences privacySettings.isProfileHidden',
      })
      .lean();
  }
}

export default new ChildRepository();

