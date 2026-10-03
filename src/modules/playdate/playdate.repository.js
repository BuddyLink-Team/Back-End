import Playdate from './playdate.model.js';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS } from './playdate.constants.js';

class PlaydateRepository {
  /**
   * Create a new playdate
   */
  async create(playdateData) {
    return Playdate.create(playdateData);
  }

  /**
   * Find playdate by ID with populated references
   */
  async findById(id) {
    return Playdate.findById(id)
      .populate('hostParentId', 'fullName avatarUrl userId verification location')
      .populate('hostChildId', 'displayName dateOfBirth gender interests favoriteActivities personality')
      .populate('participants.parentId', 'fullName avatarUrl userId verification location')
      .populate('participants.childId', 'displayName dateOfBirth gender interests favoriteActivities personality');
  }

  /**
   * Find playdates for a parent with status filtering and pagination
   */
  async findForParent(parentId, { status, search, fromDate, toDate, page = 1, limit = 50 } = {}) {
    const parentMatch = {
      $or: [
        { hostParentId: parentId },
        { 'participants.parentId': parentId },
      ],
    };

    const query = { ...parentMatch };

    // Status filter
    if (status && status !== 'all') {
      const normalizedStatus = status.toLowerCase();
      if (normalizedStatus === 'completed') {
        query.status = PLAYDATE_STATUS.COMPLETED;
      } else if (normalizedStatus === 'cancelled') {
        query.status = PLAYDATE_STATUS.CANCELLED;
      } else if (normalizedStatus === 'upcoming') {
        query.status = PLAYDATE_STATUS.UPCOMING;
      } else if (normalizedStatus === 'confirmed') {
        query.status = PLAYDATE_STATUS.UPCOMING;
        query.$and = [
          {
            $or: [
              { hostParentId: parentId },
              { participants: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.ACCEPTED } } },
            ],
          },
        ];
      } else if (normalizedStatus === 'pending') {
        query.status = PLAYDATE_STATUS.UPCOMING;
        query.$and = [
          {
            $or: [
              { participants: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.PENDING } } },
              { hostParentId: parentId, 'participants.status': PARTICIPANT_STATUS.PENDING },
            ],
          },
        ];
      }
    }

    if (search) {
      query.$or = [
        { activity: { $regex: search, $options: 'i' } },
        { 'location.name': { $regex: search, $options: 'i' } },
        { 'location.address': { $regex: search, $options: 'i' } },
      ];
    }

    if (fromDate || toDate) {
      query.scheduledDate = {};
      if (fromDate) query.scheduledDate.$gte = new Date(fromDate);
      if (toDate) query.scheduledDate.$lte = new Date(toDate);
    }

    const sortOrder = (status === 'completed' || status === 'cancelled')
      ? { scheduledDate: -1, createdAt: -1 }
      : { scheduledDate: 1, createdAt: 1 };

    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    return Playdate.find(query)
      .sort(sortOrder)
      .skip(skip)
      .limit(parsedLimit)
      .populate('hostParentId', 'fullName avatarUrl userId verification location')
      .populate('hostChildId', 'displayName dateOfBirth gender interests favoriteActivities personality')
      .populate('participants.parentId', 'fullName avatarUrl userId verification location')
      .populate('participants.childId', 'displayName dateOfBirth gender interests favoriteActivities personality');
  }

  /**
   * Count playdates by status tabs for parent dashboard
   */
  async countByStatusesForParent(parentId) {
    const parentIdStr = parentId.toString();
    const all = await Playdate.find({
      $or: [{ hostParentId: parentId }, { 'participants.parentId': parentId }],
    }).select('status hostParentId participants');

    let allCount = all.length;
    let completedCount = 0;
    let cancelledCount = 0;
    let confirmedCount = 0;
    let pendingCount = 0;

    for (const item of all) {
      if (item.status === PLAYDATE_STATUS.COMPLETED) {
        completedCount++;
      } else if (item.status === PLAYDATE_STATUS.CANCELLED) {
        cancelledCount++;
      } else if (item.status === PLAYDATE_STATUS.UPCOMING) {
        const isHost = (item.hostParentId?._id || item.hostParentId)?.toString() === parentIdStr;
        const myParticipant = item.participants?.find(
          (p) => (p.parentId?._id || p.parentId)?.toString() === parentIdStr
        );

        if (!isHost && myParticipant?.status === PARTICIPANT_STATUS.PENDING) {
          pendingCount++;
        } else if (isHost && item.participants?.some((p) => p.status === PARTICIPANT_STATUS.PENDING)) {
          pendingCount++;
        } else {
          confirmedCount++;
        }
      }
    }

    return {
      all: allCount,
      confirmed: confirmedCount,
      pending: pendingCount,
      completed: completedCount,
      cancelled: cancelledCount,
    };
  }

  /**
   * Update playdate by ID
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

export default new PlaydateRepository();
