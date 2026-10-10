import Connection from './connection.model.js';
import { CONNECTION_STATUS } from './connection.constants.js';

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
   * All accepted connections of a parent, with both parents populated
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array<Object>>}
   */
  async findAcceptedForParent(parentId) {
    return Connection.find({ parents: parentId, status: CONNECTION_STATUS.ACCEPTED })
      .populate('parents', 'fullName avatarUrl userId verification location')
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
   * @returns {Promise<Object>}
   */
  async createRequest(requesterId, recipientId) {
    return Connection.create({
      parents: [requesterId, recipientId],
      requesterId,
      recipientId,
      status: CONNECTION_STATUS.PENDING,
    });
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
  async transitionStatus(connectionId, fromStatus, toStatus) {
    const timestampField = {
      [CONNECTION_STATUS.ACCEPTED]: 'connectedAt',
      [CONNECTION_STATUS.DECLINED]: 'declinedAt',
      [CONNECTION_STATUS.REMOVED]: 'removedAt',
    }[toStatus];

    return Connection.findOneAndUpdate(
      { _id: connectionId, status: fromStatus },
      { $set: { status: toStatus, ...(timestampField ? { [timestampField]: new Date() } : {}) } },
      { new: true }
    ).lean();
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
