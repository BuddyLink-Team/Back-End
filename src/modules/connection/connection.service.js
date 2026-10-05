import connectionRepository from './connection.repository.js';

class ConnectionService {
  /**
   * Check whether two parents have an accepted connection
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<boolean>}
   */
  async areConnected(parentIdA, parentIdB) {
    if (!parentIdA || !parentIdB) return false;
    const connection = await connectionRepository.findAcceptedBetween(parentIdA, parentIdB);
    return Boolean(connection);
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
