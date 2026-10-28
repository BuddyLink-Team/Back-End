import Connection from './connection.model.js';
import { CONNECTION_STATUS } from './connection.constants.js';
import { PAGINATION } from '../../shared/constants/index.js';
import '../user/user.model.js';
import '../parent/parent.model.js';

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
   * One page of connections for admin oversight
   * @param {Object} options
   * @param {string} [options.status]
   * @param {Array<string|ObjectId>} [options.searchParentIds]
   * @param {number} [options.page=1]
   * @param {number} [options.limit=10]
   * @returns {Promise<{ items: Array<Object>, pagination: Object }>}
   */
  async findPageForAdmin({ status, searchParentIds, page = 1, limit = 10 } = {}) {
    const andConditions = [];
    if (status && status !== 'all') {
      andConditions.push({ status: status.toLowerCase() });
    }
    if (Array.isArray(searchParentIds)) {
      andConditions.push({ parents: { $in: searchParentIds } });
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0] || {};
    const parsedLimit = Math.min(PAGINATION.MAX_LIMIT, Math.max(1, parseInt(limit, 10) || PAGINATION.DEFAULT_LIMIT));
    const parsedPage = Math.max(PAGINATION.DEFAULT_PAGE, parseInt(page, 10) || PAGINATION.DEFAULT_PAGE);
    const skip = (parsedPage - 1) * parsedLimit;

    const parentFields = 'fullName avatarUrl userId verification location';
    const [total, items] = await Promise.all([
      Connection.countDocuments(query),
      Connection.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .populate({ path: 'requesterId', select: parentFields, populate: { path: 'userId', select: 'isActive email role' } })
        .populate({ path: 'recipientId', select: parentFields, populate: { path: 'userId', select: 'isActive email role' } })
        .lean(),
    ]);

    return {
      items,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }

  /**
   * Find connection with populated parents and users for admin detail view
   * @param {string|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  async findWithDetailsForAdmin(id) {
    const parentFields = 'fullName avatarUrl userId verification location bio';
    return Connection.findById(id)
      .populate({ path: 'requesterId', select: parentFields, populate: { path: 'userId', select: 'isActive email role' } })
      .populate({ path: 'recipientId', select: parentFields, populate: { path: 'userId', select: 'isActive email role' } })
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
}

export const connectionRepository = new ConnectionRepository();
export default connectionRepository;
