import Connection from './connection.model.js';
import { CONNECTION_STATUS } from './connection.constants.js';

// Parent fields shown in the admin portal (the admin DTO reduces location to area / city)
const ADMIN_PARENT_FIELDS = 'fullName avatarUrl userId verification location';
const ADMIN_PARENT_USER_POPULATE = { path: 'userId', select: 'isActive email role' };

class ConnectionRepository {
  /**
   * Find the accepted connection between two parents (direction-independent)
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<Object|null>}
   */
  async findAcceptedBetween(parentIdA, parentIdB) {
    return Connection.findOne({
      parents: { $all: [parentIdA, parentIdB] },
      status: CONNECTION_STATUS.ACCEPTED,
    }).lean();
  }

  /**
   * All accepted connections of a parent (with their child pairs), both parents populated
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array<Object>>}
   */
  async findAcceptedForParent(parentId) {
    return Connection.find({ parents: parentId, status: CONNECTION_STATUS.ACCEPTED })
      .populate('parents', 'fullName avatarUrl userId verification location preferences')
      .lean();
  }

  /**
   * Number of accepted connections of a parent (one connection per parent pair)
   * @param {string|ObjectId} parentId
   * @returns {Promise<number>}
   */
  async countAcceptedForParent(parentId) {
    return Connection.countDocuments({ parents: parentId, status: CONNECTION_STATUS.ACCEPTED });
  }

  /**
   * Connections across the platform counted by status
   * @returns {Promise<{ total: number, pending: number, accepted: number, declined: number, removed: number }>}
   */
  async countByStatus() {
    const rows = await Connection.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const countOf = (status) => rows.find((row) => row._id === status)?.count || 0;
    return {
      total: rows.reduce((sum, row) => sum + row.count, 0),
      pending: countOf(CONNECTION_STATUS.PENDING),
      accepted: countOf(CONNECTION_STATUS.ACCEPTED),
      declined: countOf(CONNECTION_STATUS.DECLINED),
      removed: countOf(CONNECTION_STATUS.REMOVED),
    };
  }

  /**
   * Find the pending or accepted connection between two parents (direction-independent)
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<Object|null>}
   */
  async findActiveBetween(parentIdA, parentIdB) {
    return Connection.findOne({
      parents: { $all: [parentIdA, parentIdB] },
      status: { $in: [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED] },
    }).lean();
  }

  /**
   * Set any active (pending or accepted) connection between two parents to removed.
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<Object>}
   */
  async removeActiveBetween(parentIdA, parentIdB) {
    return Connection.updateMany(
      {
        parents: { $all: [parentIdA, parentIdB] },
        status: { $in: [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED] },
      },
      {
        $set: {
          status: CONNECTION_STATUS.REMOVED,
          removedAt: new Date(),
        },
      }
    );
  }

  /**
   * Accept a pending connection request
   * @param {string|ObjectId} connectionId
   * @returns {Promise<Object|null>} The accepted connection, or null if it is no longer pending
   */
  async acceptPendingById(connectionId) {
    return Connection.findOneAndUpdate(
      { _id: connectionId, status: CONNECTION_STATUS.PENDING },
      { $set: { status: CONNECTION_STATUS.ACCEPTED, connectedAt: new Date() } },
      { new: true }
    ).lean();
  }

  /**
   * Create a pending connection request
   * @param {string|ObjectId} requesterId
   * @param {string|ObjectId} recipientId
   * @param {Array<Object>} [childPairs] - Child pairs known when the request is sent
   * @returns {Promise<Object>}
   */
  async createRequest(requesterId, recipientId, childPairs = []) {
    return Connection.create({
      parents: [requesterId, recipientId],
      requesterId,
      recipientId,
      status: CONNECTION_STATUS.PENDING,
      childPairs,
    });
  }

  /**
   * Add a child pair to a connection. Atomic and without duplicates: only pushes when no pair
   * with the same pairKey is on the connection yet.
   * @param {string|ObjectId} connectionId
   * @param {Object} pair - { childIds, pairKey, source, matchScore }
   * @returns {Promise<Object|null>} Updated connection, or null when the pair already existed
   */
  async addChildPair(connectionId, pair) {
    return Connection.findOneAndUpdate(
      { _id: connectionId, 'childPairs.pairKey': { $ne: pair.pairKey } },
      { $push: { childPairs: pair } },
      { new: true }
    ).lean();
  }

  /**
   * @param {string|ObjectId} connectionId
   * @returns {Promise<Object|null>}
   */
  async findById(connectionId) {
    return Connection.findById(connectionId).lean();
  }

  /**
   * Move a connection from one status to another (atomic: null when it is no longer in fromStatus)
   * @param {string|ObjectId} connectionId
   * @param {string} fromStatus - Status the connection must still have
   * @param {string} toStatus - accepted | declined | removed
   * @returns {Promise<Object|null>} Updated connection
   */
  async transitionStatus(connectionId, fromStatus, toStatus, extraFields = {}) {
    const timestampField = {
      [CONNECTION_STATUS.ACCEPTED]: 'connectedAt',
      [CONNECTION_STATUS.DECLINED]: 'declinedAt',
      [CONNECTION_STATUS.REMOVED]: 'removedAt',
    }[toStatus];

    return Connection.findOneAndUpdate(
      { _id: connectionId, status: fromStatus },
      {
        $set: {
          status: toStatus,
          ...(timestampField ? { [timestampField]: new Date() } : {}),
          ...extraFields,
        },
      },
      { new: true }
    ).lean();
  }

  /**
   * One page of connections for admin oversight, newest first
   * @param {Object} options
   * @param {string} [options.status] - Connection status, or 'all' / empty for every status
   * @param {Array<string|ObjectId>|null} [options.searchParentIds] - Only connections of these parents (null = no filter)
   * @param {number} options.page
   * @param {number} options.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPageForAdmin({ status, searchParentIds = null, page, limit }) {
    const andConditions = [];
    if (status && status !== 'all') {
      andConditions.push({ status: status.toLowerCase() });
    }
    if (Array.isArray(searchParentIds)) {
      andConditions.push({ parents: { $in: searchParentIds } });
    }
    const filter = andConditions.length > 1 ? { $and: andConditions } : andConditions[0] || {};

    const [items, total] = await Promise.all([
      Connection.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'requesterId', select: ADMIN_PARENT_FIELDS, populate: ADMIN_PARENT_USER_POPULATE })
        .populate({ path: 'recipientId', select: ADMIN_PARENT_FIELDS, populate: ADMIN_PARENT_USER_POPULATE })
        .lean(),
      Connection.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Find connection with populated parents and users for admin detail view
   * @param {string|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  async findWithDetailsForAdmin(id) {
    return Connection.findById(id)
      .populate({ path: 'requesterId', select: `${ADMIN_PARENT_FIELDS} bio`, populate: ADMIN_PARENT_USER_POPULATE })
      .populate({ path: 'recipientId', select: `${ADMIN_PARENT_FIELDS} bio`, populate: ADMIN_PARENT_USER_POPULATE })
      .populate('childPairs.childIds', 'displayName dateOfBirth gender isArchived parentId')
      .lean();
  }

  /**
   * One page of a parent's connections, newest first, both sides populated (public card fields only)
   * @param {string|ObjectId} parentId
   * @param {Object} [filters]
   * @param {string} [filters.status]
   * @param {'incoming'|'outgoing'} [filters.direction]
   * @param {Array<string|ObjectId>} [filters.excludeParentIds] - Hidden parents (block relationships)
   * @param {Array<string|ObjectId>} [filters.partnerIds] - Only connections with one of these parents (search)
   * @param {{ page: number, limit: number }} pagination
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPageForParent(parentId, { status, direction, excludeParentIds = [], partnerIds } = {}, { page, limit }) {
    const conditions = [{ parents: parentId }];
    if (status) conditions.push({ status });
    if (direction === 'incoming') conditions.push({ recipientId: parentId });
    if (direction === 'outgoing') conditions.push({ requesterId: parentId });
    if (excludeParentIds.length) conditions.push({ parents: { $nin: excludeParentIds } });
    if (partnerIds) conditions.push({ parents: { $in: partnerIds } });
    const query = { $and: conditions };

    const parentFields = 'fullName avatarUrl location.area location.city verification.isVerifiedParent preferences';
    const [items, total] = await Promise.all([
      Connection.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('requesterId', parentFields)
        .populate('recipientId', parentFields)
        .lean(),
      Connection.countDocuments(query),
    ]);
    return { items, total };
  }

  /**
   * Count accepted connections on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countAcceptedBeforeDate(date) {
    const filter = { status: CONNECTION_STATUS.ACCEPTED };
    if (date) filter.connectedAt = { $lte: date };
    return Connection.countDocuments(filter);
  }

  /**
   * Count distinct parents with at least one accepted connection on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countDistinctParentsWithConnectionBeforeDate(date) {
    const filter = { status: CONNECTION_STATUS.ACCEPTED };
    if (date) filter.connectedAt = { $lte: date };
    const parents = await Connection.distinct('parents', filter);
    return parents.length;
  }

  /**
   * Connection metrics in a date range (sent, accepted, declined, pending, removed, acceptance rate)
   * @param {{ fromDate?: Date, toDate?: Date }} params
   * @returns {Promise<{ sent: number, accepted: number, declined: number, pending: number, removed: number, acceptanceRate: number }>}
   */
  async getConnectionAnalytics({ fromDate, toDate } = {}) {
    const match = {};
    if (fromDate || toDate) {
      match.createdAt = {};
      if (fromDate) match.createdAt.$gte = fromDate;
      if (toDate) match.createdAt.$lte = toDate;
    }
    const rows = await Connection.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const countOf = (status) => rows.find((r) => r._id === status)?.count || 0;
    const sent = rows.reduce((sum, r) => sum + r.count, 0);
    const accepted = countOf(CONNECTION_STATUS.ACCEPTED);
    const declined = countOf(CONNECTION_STATUS.DECLINED);
    const pending = countOf(CONNECTION_STATUS.PENDING);
    const removed = countOf(CONNECTION_STATUS.REMOVED);
    const acceptanceRate = sent > 0 ? Number(((accepted / sent) * 100).toFixed(1)) : 0;
    return { sent, accepted, declined, pending, removed, acceptanceRate };
  }
}

export const connectionRepository = new ConnectionRepository();
export default connectionRepository;
