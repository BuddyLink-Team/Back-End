import Connection from './connection.model.js';
import { CONNECTION_STATUS } from './connection.constants.js';

class ConnectionService {
  /**
   * Check if two parents are accepted friends
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<boolean>}
   */
  async areParentsConnected(parentIdA, parentIdB) {
    const conn = await Connection.findOne({
      parents: { $all: [parentIdA, parentIdB] },
      status: CONNECTION_STATUS.ACCEPTED,
    });
    return !!conn;
  }

  /**
   * Get all accepted connection documents for a parent
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array>}
   */
  async getAcceptedConnections(parentId) {
    return Connection.find({
      parents: parentId,
      status: CONNECTION_STATUS.ACCEPTED,
    }).populate('parents', 'fullName avatarUrl userId verification location');
  }
}

export default new ConnectionService();
