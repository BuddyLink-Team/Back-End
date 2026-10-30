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

  async findById(id) {
    return Child.findById(id);
  }

  async findAllByParentId(parentId) {
    return Child.find({ parentId }).sort({ createdAt: -1 }).lean();
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

  /**
   * Active children of several parents in one query, newest first
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Array<Object>>}
   */
  async findByParentIds(parentIds) {
    if (!parentIds.length) return [];
    return Child.find({ parentId: { $in: parentIds }, isArchived: false }).sort({ createdAt: -1 }).lean();
  }

  /**
   * IDs of the active children of several parents, oldest first (order used by the Free child limit)
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Array<{ _id: ObjectId, parentId: ObjectId }>>}
   */
  async findIdsByParentIdsOldestFirst(parentIds) {
    if (!parentIds.length) return [];
    return Child.find({ parentId: { $in: parentIds }, isArchived: false })
      .select('_id parentId')
      .sort({ createdAt: 1, _id: 1 })
      .lean();
  }

  /**
   * Active children by ID, in one query
   * @param {Array<string|ObjectId>} childIds
   * @returns {Promise<Array<Object>>}
   */
  async findActiveByIds(childIds) {
    if (!childIds.length) return [];
    return Child.find({ _id: { $in: childIds }, isArchived: false }).lean();
  }

  /**
   * IDs of the parents having an active child whose name contains the text
   * @param {string} search
   * @returns {Promise<Array<ObjectId>>}
   */
  async findParentIdsByChildName(search) {
    return Child.distinct('parentId', {
      displayName: { $regex: escapeRegExp(search), $options: 'i' },
      isArchived: false,
    });
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
        select: 'userId fullName avatarUrl bio location.area location.city verification preferences privacySettings.isProfileHidden',
      })
      .lean();
  }

  /**
   * Page of child profiles for admin lists, newest first
   * @param {Object} criteria
   * @param {string} [criteria.search] - Matches the child name
   * @param {Array<string|ObjectId>} [criteria.searchParentIds] - Parents also matched by the search (parent name)
   * @param {string} [criteria.gender]
   * @param {boolean} [criteria.isArchived]
   * @param {Array<string|ObjectId>|null} [criteria.restrictToIds] - Only these profiles; null = no restriction
   * @param {Array<string|ObjectId>|null} [criteria.excludeIds] - Never these profiles; null = no exclusion
   * @param {Date} [criteria.bornAfter] - Exclusive lower bound of the date of birth
   * @param {Date} [criteria.bornOnOrBefore] - Inclusive upper bound of the date of birth
   * @param {number} criteria.page
   * @param {number} criteria.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPage({
    search,
    searchParentIds = [],
    gender,
    isArchived,
    bornAfter,
    bornOnOrBefore,
    restrictToIds = null,
    excludeIds = null,
    page,
    limit,
  }) {
    const filter = {};
    if (restrictToIds || excludeIds) {
      filter._id = {
        ...(restrictToIds ? { $in: restrictToIds } : {}),
        ...(excludeIds ? { $nin: excludeIds } : {}),
      };
    }
    if (gender) filter.gender = gender;
    if (typeof isArchived === 'boolean') filter.isArchived = isArchived;
    if (bornAfter || bornOnOrBefore) {
      filter.dateOfBirth = {};
      if (bornAfter) filter.dateOfBirth.$gt = bornAfter;
      if (bornOnOrBefore) filter.dateOfBirth.$lte = bornOnOrBefore;
    }
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      filter.$or = [{ displayName: regex }, { parentId: { $in: searchParentIds } }];
    }

    const [items, total] = await Promise.all([
      Child.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Child.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Child profiles by archive status, for admin statistics
   * @returns {Promise<{ total: number, active: number, archived: number }>}
   */
  async countByArchiveStatus() {
    const rows = await Child.aggregate([{ $group: { _id: '$isArchived', count: { $sum: 1 } } }]);
    const archived = rows.find((row) => row._id === true)?.count || 0;
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return { total, active: total - archived, archived };
  }

  /**
   * Parents with more than `minCount` active children, and how many they have
   * @param {number} minCount
   * @returns {Promise<Array<{ _id: ObjectId, count: number }>>}
   */
  async findParentsWithActiveChildrenAbove(minCount) {
    return Child.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$parentId', count: { $sum: 1 } } },
      { $match: { count: { $gt: minCount } } },
    ]);
  }

  /**
   * Number of active (non-archived) children per parent
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Array<{ _id: ObjectId, count: number }>>}
   */
  async countActiveGroupedByParentIds(parentIds) {
    if (!parentIds.length) return [];
    return Child.aggregate([
      { $match: { parentId: { $in: parentIds.map((id) => new mongoose.Types.ObjectId(id)) }, isArchived: false } },
      { $group: { _id: '$parentId', count: { $sum: 1 } } },
    ]);
  }

  /**
   * Count active children created on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countActiveBeforeDate(date) {
    const filter = { isArchived: false };
    if (date) filter.createdAt = { $lte: date };
    return Child.countDocuments(filter);
  }

  /**
   * Count distinct parents who created at least one active child profile on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countDistinctParentsWithActiveChildrenBeforeDate(date) {
    const filter = { isArchived: false };
    if (date) filter.createdAt = { $lte: date };
    const distinctParents = await Child.distinct('parentId', filter);
    return distinctParents.length;
  }

  /**
   * Count active children by birth date groups
   * @param {Array<{ key: string, bornAfter: Date|null }>} groups - Youngest first; the last one takes everyone left
   * @returns {Promise<Array<{ key: string, count: number }>>}
   */
  async countByBirthDateGroups(groups) {
    const branches = groups
      .filter((group) => group.bornAfter)
      .map((group) => ({ case: { $gt: ['$dateOfBirth', group.bornAfter] }, then: group.key }));
    const rows = await Child.aggregate([
      { $match: { isArchived: false, dateOfBirth: { $ne: null } } },
      { $group: { _id: { $switch: { branches, default: groups[groups.length - 1].key } }, count: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({ key: row._id, count: row.count }));
  }
}

export default new ChildRepository();

