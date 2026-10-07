import mongoose from 'mongoose';
import Playdate from './playdate.model.js';
// Register referenced models so populate() works regardless of import order
import '../parent/parent.model.js';
import '../child/child.model.js';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS } from './playdate.constants.js';

class PlaydateRepository {
  /**
   * Create a new playdate document
   * @param {Object} playdateData
   * @returns {Promise<Playdate>}
   */
  async create(playdateData) {
    return Playdate.create(playdateData);
  }

  /**
   * Find playdate by ID with populated references
   * @param {string|ObjectId} id
   * @returns {Promise<Playdate|null>}
   */
  async findById(id) {
    return Playdate.findById(id)
      .populate('hostParentId', 'fullName avatarUrl userId verification location')
      .populate('hostChildId', 'displayName dateOfBirth gender interests favoriteActivities personality')
      .populate('participants.parentId', 'fullName avatarUrl userId verification location')
      .populate('participants.childId', 'displayName dateOfBirth gender interests favoriteActivities personality');
  }

  /**
   * Find playdate document by ID without populated references (for updates)
   * @param {string|ObjectId} id
   * @returns {Promise<Document|null>}
   */
  async findDocById(id) {
    return Playdate.findById(id);
  }

  /**
   * Find playdate with full details (populated host & participants), as a plain object
   * @param {string|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  async findWithDetails(id) {
    return Playdate.findById(id)
      .populate('hostParentId', 'fullName avatarUrl verification location')
      .populate('hostChildId', 'displayName dateOfBirth gender interests')
      .populate('participants.parentId', 'fullName avatarUrl verification location')
      .populate('participants.childId', 'displayName dateOfBirth gender interests')
      .lean();
  }

  /**
   * Update chatConversationId on a playdate
   * @param {string|ObjectId} playdateId
   * @param {string|ObjectId} conversationId
   */
  async updateChatConversationId(playdateId, conversationId) {
    return Playdate.findByIdAndUpdate(
      playdateId,
      { $set: { chatConversationId: conversationId } },
      { new: true }
    );
  }

  /**
   * Find playdates for a parent with status filtering and pagination
   * @param {string|ObjectId} parentId
   * @param {Object} queryOptions
   * @returns {Promise<{ playdates: Array, pagination: Object }>}
   */
  async findForParent(parentId, { status, search, fromDate, toDate, page = 1, limit = 50 } = {}) {
    const parentMatch = {
      $or: [
        { hostParentId: parentId },
        { 'participants.parentId': parentId },
      ],
    };

    const andConditions = [parentMatch];

    // Status filtering condition
    if (status && status !== 'all') {
      const normalizedStatus = status.toLowerCase();
      if (normalizedStatus === 'completed') {
        andConditions.push({ status: PLAYDATE_STATUS.COMPLETED });
      } else if (normalizedStatus === 'cancelled') {
        andConditions.push({ status: PLAYDATE_STATUS.CANCELLED });
      } else if (normalizedStatus === 'upcoming') {
        andConditions.push({ status: PLAYDATE_STATUS.UPCOMING });
      } else if (normalizedStatus === 'confirmed') {
        andConditions.push({
          status: PLAYDATE_STATUS.UPCOMING,
          $or: [
            { hostParentId: parentId },
            { participants: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.ACCEPTED } } },
          ],
        });
      } else if (normalizedStatus === 'pending') {
        andConditions.push({
          status: PLAYDATE_STATUS.UPCOMING,
          $or: [
            { participants: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.PENDING } } },
            { hostParentId: parentId, 'participants.status': PARTICIPANT_STATUS.PENDING },
          ],
        });
      }
    }

    // Safely escaped search condition to prevent ReDoS and injection
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      andConditions.push({
        $or: [
          { activity: { $regex: escaped, $options: 'i' } },
          { 'location.name': { $regex: escaped, $options: 'i' } },
          { 'location.address': { $regex: escaped, $options: 'i' } },
        ],
      });
    }

    // Date range filter
    if (fromDate || toDate) {
      const dateCond = {};
      if (fromDate) dateCond.$gte = new Date(fromDate);
      if (toDate) dateCond.$lte = new Date(toDate);
      andConditions.push({ scheduledDate: dateCond });
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0];

    const sortOrder = (status === 'completed' || status === 'cancelled')
      ? { scheduledDate: -1, createdAt: -1 }
      : { scheduledDate: 1, createdAt: 1 };

    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [total, playdates] = await Promise.all([
      Playdate.countDocuments(query),
      Playdate.find(query)
        .sort(sortOrder)
        .skip(skip)
        .limit(parsedLimit)
        .populate('hostParentId', 'fullName avatarUrl userId verification location')
        .populate('hostChildId', 'displayName dateOfBirth gender interests favoriteActivities personality')
        .populate('participants.parentId', 'fullName avatarUrl userId verification location')
        .populate('participants.childId', 'displayName dateOfBirth gender interests favoriteActivities personality'),
    ]);

    const totalPages = Math.ceil(total / parsedLimit) || 1;

    return {
      playdates,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Count playdates by status tabs using MongoDB Aggregation
   * Avoids loading all documents into application memory
   * @param {string|ObjectId} parentId
   * @returns {Promise<Object>}
   */
  async countByStatusesForParent(parentId) {
    const parentObjId = new mongoose.Types.ObjectId(parentId);
    const results = await Playdate.aggregate([
      {
        $match: {
          $or: [
            { hostParentId: parentObjId },
            { 'participants.parentId': parentObjId },
          ],
        },
      },
      {
        $group: {
          _id: null,
          all: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ['$status', PLAYDATE_STATUS.COMPLETED] }, 1, 0],
            },
          },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ['$status', PLAYDATE_STATUS.CANCELLED] }, 1, 0],
            },
          },
          pending: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', PLAYDATE_STATUS.UPCOMING] },
                    {
                      $or: [
                        {
                          $and: [
                            { $ne: ['$hostParentId', parentObjId] },
                            {
                              $gt: [
                                {
                                  $size: {
                                    $filter: {
                                      input: { $ifNull: ['$participants', []] },
                                      as: 'p',
                                      cond: {
                                        $and: [
                                          { $eq: ['$$p.parentId', parentObjId] },
                                          { $eq: ['$$p.status', PARTICIPANT_STATUS.PENDING] },
                                        ],
                                      },
                                    },
                                  },
                                },
                                0,
                              ],
                            },
                          ],
                        },
                        {
                          $and: [
                            { $eq: ['$hostParentId', parentObjId] },
                            {
                              $gt: [
                                {
                                  $size: {
                                    $filter: {
                                      input: { $ifNull: ['$participants', []] },
                                      as: 'p',
                                      cond: { $eq: ['$$p.status', PARTICIPANT_STATUS.PENDING] },
                                    },
                                  },
                                },
                                0,
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const stats = results[0] || { all: 0, completed: 0, cancelled: 0, pending: 0 };
    const upcomingCount = stats.all - stats.completed - stats.cancelled;
    const confirmedCount = Math.max(0, upcomingCount - stats.pending);

    return {
      all: stats.all,
      confirmed: confirmedCount,
      pending: stats.pending,
      completed: stats.completed,
      cancelled: stats.cancelled,
    };
  }

  /**
   * Update playdate by ID
   * @param {string|ObjectId} id
   * @param {Object} updateData
   * @returns {Promise<Playdate|null>}
   */
  async updateById(id, updateData) {
    return Playdate.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate('hostParentId', 'fullName avatarUrl userId verification location')
      .populate('hostChildId', 'displayName dateOfBirth gender interests favoriteActivities personality')
      .populate('participants.parentId', 'fullName avatarUrl userId verification location')
      .populate('participants.childId', 'displayName dateOfBirth gender interests favoriteActivities personality');
  }
}

export const playdateRepository = new PlaydateRepository();
export default playdateRepository;
