import mongoose from 'mongoose';
import Playdate from './playdate.model.js';
// Register referenced models so populate() works regardless of import order
import '../parent/parent.model.js';
import '../child/child.model.js';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS } from './playdate.constants.js';
import { PAGINATION } from '../../shared/constants/index.js';
import { escapeRegExp } from '../../shared/helpers/regex.helper.js';

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
  async findForParent(rawParentId, { status, search, fromDate, toDate, page = 1, limit = 50 } = {}) {
    // The list is read with an aggregation, which does not cast ids like find() does
    const parentId = new mongoose.Types.ObjectId(rawParentId);
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
        // Same rule as the displayStatus: the host's playdate once someone accepted and nobody is pending
        andConditions.push({
          status: PLAYDATE_STATUS.UPCOMING,
          $or: [
            {
              hostParentId: parentId,
              $and: [
                { 'participants.status': PARTICIPANT_STATUS.ACCEPTED },
                { 'participants.status': { $ne: PARTICIPANT_STATUS.PENDING } },
              ],
            },
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
      const escaped = escapeRegExp(search.trim());
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

    const parsedLimit = Math.min(PAGINATION.MAX_LIMIT, Math.max(1, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(PAGINATION.DEFAULT_PAGE, parseInt(page, 10) || PAGINATION.DEFAULT_PAGE);
    const skip = (parsedPage - 1) * parsedLimit;

    // Order: upcoming playdates first, the soonest first (date AND start time); then the past ones
    // (completed / cancelled), the most recent first. Same rule on every tab.
    const startMinutes = {
      $add: [
        { $multiply: [{ $convert: { input: { $substrBytes: ['$time', 0, 2] }, to: 'int', onError: 0, onNull: 0 } }, 60] },
        { $convert: { input: { $substrBytes: ['$time', 3, 2] }, to: 'int', onError: 0, onNull: 0 } },
      ],
    };
    const [total, ordered] = await Promise.all([
      Playdate.countDocuments(query),
      Playdate.aggregate([
        { $match: query },
        {
          $addFields: {
            _isPast: { $cond: [{ $eq: ['$status', PLAYDATE_STATUS.UPCOMING] }, 0, 1] },
            _startMs: { $add: [{ $toLong: '$scheduledDate' }, { $multiply: [startMinutes, 60000] }] },
          },
        },
        { $addFields: { _sortKey: { $cond: [{ $eq: ['$_isPast', 0] }, '$_startMs', { $multiply: ['$_startMs', -1] }] } } },
        { $sort: { _isPast: 1, _sortKey: 1, _id: 1 } },
        { $skip: skip },
        { $limit: parsedLimit },
        { $project: { _isPast: 0, _startMs: 0, _sortKey: 0 } },
      ]),
    ]);
    const playdates = await Playdate.populate(ordered, [
      { path: 'hostParentId', select: 'fullName avatarUrl userId verification location' },
      { path: 'hostChildId', select: 'displayName dateOfBirth gender interests favoriteActivities personality' },
      { path: 'participants.parentId', select: 'fullName avatarUrl userId verification location' },
      { path: 'participants.childId', select: 'displayName dateOfBirth gender interests favoriteActivities personality' },
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
          // Same rule as the displayStatus 'confirmed'
          confirmed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', PLAYDATE_STATUS.UPCOMING] },
                    {
                      $or: [
                        {
                          $and: [
                            { $eq: ['$hostParentId', parentObjId] },
                            { $in: [PARTICIPANT_STATUS.ACCEPTED, { $ifNull: ['$participants.status', []] }] },
                            { $not: [{ $in: [PARTICIPANT_STATUS.PENDING, { $ifNull: ['$participants.status', []] }] }] },
                          ],
                        },
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
                                      { $eq: ['$$p.status', PARTICIPANT_STATUS.ACCEPTED] },
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

    const stats = results[0] || { all: 0, completed: 0, cancelled: 0, pending: 0, confirmed: 0 };
    const upcomingCount = stats.all - stats.completed - stats.cancelled;

    return {
      all: stats.all,
      upcoming: upcomingCount,
      confirmed: stats.confirmed,
      pending: stats.pending,
      completed: stats.completed,
      cancelled: stats.cancelled,
    };
  }

  /**
   * Delete a playdate (rollback when a step after creation fails)
   * @param {string|ObjectId} id
   */
  async deleteById(id) {
    return Playdate.deleteOne({ _id: id });
  }

  /**
   * Atomically set the RSVP of a participant who has not answered yet
   * @param {string|ObjectId} id
   * @param {string|ObjectId} parentId
   * @param {string} status - accepted | declined
   * @returns {Promise<Object|null>} null when the participant was not pending anymore
   */
  async updatePendingParticipantStatus(id, parentId, status) {
    return Playdate.findOneAndUpdate(
      { _id: id, participants: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.PENDING } } },
      { $set: { 'participants.$.status': status, 'participants.$.respondedAt': new Date() } },
      { new: true },
    ).lean();
  }

  /**
   * Atomically invite families to an upcoming playdate: new families are appended, families who
   * declined or left get their entry back to pending (same place in the list)
   * @param {string|ObjectId} id
   * @param {Array<{ parentId: string, childId: string, status: string, invitedAt: Date }>} participants
   * @param {Array<string>} [reinvitedParentIds] - families already in the playdate with a declined status
   * @returns {Promise<Object|null>} null when the playdate is not upcoming anymore, a new family got in
   *   or a re-invited family is not declined anymore in the meantime
   */
  async addParticipants(id, participants, reinvitedParentIds = []) {
    const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));
    const reinvited = new Set(reinvitedParentIds.map(String));
    // Update pipelines are not cast by Mongoose
    const entries = participants.map((p) => ({
      parentId: toObjectId(p.parentId),
      childId: toObjectId(p.childId),
      status: p.status,
      invitedAt: p.invitedAt,
      respondedAt: null,
    }));
    const fresh = entries.filter((e) => !reinvited.has(e.parentId.toString()));
    const renewed = entries.filter((e) => reinvited.has(e.parentId.toString()));

    const kept = renewed.length
      ? {
          $map: {
            input: '$participants',
            as: 'p',
            in: {
              $switch: {
                branches: renewed.map((e) => ({ case: { $eq: ['$$p.parentId', e.parentId] }, then: { $literal: e } })),
                default: '$$p',
              },
            },
          },
        }
      : '$participants';

    return Playdate.findOneAndUpdate(
      {
        _id: id,
        status: PLAYDATE_STATUS.UPCOMING,
        'participants.parentId': { $nin: fresh.map((e) => e.parentId) },
        ...(renewed.length && {
          $and: renewed.map((e) => ({
            participants: { $elemMatch: { parentId: e.parentId, status: PARTICIPANT_STATUS.DECLINED } },
          })),
        }),
      },
      [{ $set: { participants: { $concatArrays: [kept, { $literal: fresh }] } } }],
      { new: true },
    ).lean();
  }

  /**
   * Mark a participant who has not declined yet as declined, only while the playdate is upcoming
   * (atomic: a concurrent cancel/complete or a double click cannot leave twice)
   * @param {string|ObjectId} id
   * @param {string|ObjectId} parentId
   * @returns {Promise<Object|null>} null when the playdate is no longer upcoming or the parent already left
   */
  async markParticipantLeft(id, parentId) {
    return Playdate.findOneAndUpdate(
      {
        _id: id,
        status: PLAYDATE_STATUS.UPCOMING,
        participants: { $elemMatch: { parentId, status: { $ne: PARTICIPANT_STATUS.DECLINED } } },
      },
      { $set: { 'participants.$.status': PARTICIPANT_STATUS.DECLINED, 'participants.$.respondedAt': new Date() } },
      { new: true },
    ).lean();
  }

  /**
   * Revert a participant's RSVP back to pending (rollback when quota consumption fails)
   * @param {string|ObjectId} id
   * @param {string|ObjectId} parentId
   */
  async resetParticipantToPending(id, parentId) {
    return Playdate.updateOne(
      { _id: id, 'participants.parentId': parentId },
      { $set: { 'participants.$.status': PARTICIPANT_STATUS.PENDING, 'participants.$.respondedAt': null } },
    );
  }

  /**
   * Completed playdates a parent attended (as host or accepted participant)
   * @param {string|ObjectId} parentId
   * @param {{ excludeIds?: Array<string|ObjectId>, select?: string }} [options]
   * @returns {Promise<Array<Object>>} Oldest completion first
   */
  async findCompletedForParent(parentId, { excludeIds = [], select = 'completedAt scheduledDate location' } = {}) {
    return Playdate.find({
      status: PLAYDATE_STATUS.COMPLETED,
      $or: [
        { hostParentId: parentId },
        { participants: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.ACCEPTED } } },
      ],
      ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
    })
      .select(select)
      .sort({ completedAt: 1, _id: 1 })
      .lean();
  }

  /**
   * Upcoming playdates whose scheduled date is before a cutoff
   * @param {Date} cutoff
   * @returns {Promise<Array<Object>>}
   */
  async findUpcomingBefore(cutoff) {
    return Playdate.find({ status: PLAYDATE_STATUS.UPCOMING, scheduledDate: { $lt: cutoff } })
      .select('_id participants scheduledDate')
      .lean();
  }

  /**
   * Upcoming playdates of some children (as the host child, or an accepted participant child)
   * scheduled between two dates
   * @param {Array<string|ObjectId>} childIds
   * @param {{ from: Date, to: Date, excludePlaydateId?: string|ObjectId }} window - scheduledDate range
   * @returns {Promise<Array<Object>>}
   */
  async findUpcomingForChildren(childIds, { from, to, excludePlaydateId } = {}) {
    if (!childIds.length) return [];
    return Playdate.find({
      status: PLAYDATE_STATUS.UPCOMING,
      scheduledDate: { $gte: from, $lte: to },
      ...(excludePlaydateId ? { _id: { $ne: excludePlaydateId } } : {}),
      $or: [
        { hostChildId: { $in: childIds } },
        { participants: { $elemMatch: { childId: { $in: childIds }, status: PARTICIPANT_STATUS.ACCEPTED } } },
      ],
    })
      .select('_id hostParentId hostChildId participants scheduledDate time durationMinutes')
      .lean();
  }

  /**
   * Upcoming playdates scheduled between two dates, with what a reminder needs
   * @param {Date} from
   * @param {Date} to
   * @returns {Promise<Array<Object>>}
   */
  async findUpcomingScheduledBetween(from, to) {
    return Playdate.find({ status: PLAYDATE_STATUS.UPCOMING, scheduledDate: { $gte: from, $lte: to } })
      .select('_id hostParentId participants scheduledDate time activity location reminders')
      .lean();
  }

  /**
   * Atomically mark a reminder as sent. Only one caller wins, so a reminder is never sent twice
   * (even with several server instances).
   * @param {string|ObjectId} id
   * @param {'h24'|'h1'} kind
   * @param {Date} now
   * @returns {Promise<Object|null>} The playdate when this caller claimed the reminder, otherwise null
   */
  async claimReminder(id, kind, now) {
    const field = `reminders.${kind}SentAt`;
    return Playdate.findOneAndUpdate(
      { _id: id, status: PLAYDATE_STATUS.UPCOMING, [field]: null },
      { $set: { [field]: now } },
      { new: true }
    ).lean();
  }

  /**
   * Mark the 24h reminder as done without sending it (the 1h reminder already went out)
   * @param {string|ObjectId} id
   * @param {Date} now
   */
  async skipH24Reminder(id, now) {
    return Playdate.updateOne({ _id: id, 'reminders.h24SentAt': null }, { $set: { 'reminders.h24SentAt': now } });
  }

  /**
   * Update a playdate only while it is still upcoming (no race with host actions)
   * @param {string|ObjectId} id
   * @param {Object} updateData
   * @returns {Promise<Object|null>}
   */
  async updateIfUpcoming(id, updateData) {
    return Playdate.findOneAndUpdate(
      { _id: id, status: PLAYDATE_STATUS.UPCOMING },
      { $set: updateData },
      { new: true },
    ).lean();
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
