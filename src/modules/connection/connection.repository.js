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
}

export const connectionRepository = new ConnectionRepository();
export default connectionRepository;
