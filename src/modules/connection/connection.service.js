import connectionRepository from './connection.repository.js';
import parentService from '../parent/parent.service.js';
import safetyService from '../safety/safety.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { CONNECTION_PRIVACY } from '../parent/parent.constants.js';
import { CONNECTION_STATUS } from './connection.constants.js';
import { emitConnectionEvent, CONNECTION_EVENTS } from './connection.events.js';

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

  /**
   * Same as areConnected (name used by the playdate module)
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<boolean>}
   */
  async areParentsConnected(parentIdA, parentIdB) {
    return this.areConnected(parentIdA, parentIdB);
  }

  /**
   * Get all accepted connections of a parent (both parents populated)
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array<Object>>}
   */
  async getAcceptedConnections(parentId) {
    return connectionRepository.findAcceptedForParent(parentId);
  }

  /**
   * Count the accepted connections of a parent
   * @param {string|ObjectId} parentId
   * @returns {Promise<number>}
   */
  async countAcceptedConnections(parentId) {
    return connectionRepository.countAcceptedForParent(parentId);
  }

  /**
   * Check that a connection request can be sent, without consuming any quota.
   * Lets callers (e.g. discovery Like) fail before spending their own quota.
   *
   * @param {string|ObjectId} requesterParentId
   * @param {string|ObjectId} recipientParentId
   * @returns {Promise<{existingConnection: Object|null}>}
   */
  async validateConnectionRequest(requesterParentId, recipientParentId) {
    if (requesterParentId.toString() === recipientParentId.toString()) {
      throw new AppError('You cannot connect with yourself', 400, 'SELF_CONNECTION_NOT_ALLOWED');
    }

    const recipient = await parentService.getParentById(recipientParentId);
    if (!recipient) {
      throw new AppError('Target parent not found', 404, 'TARGET_PARENT_NOT_FOUND');
    }
    if (recipient.privacySettings?.connectionPrivacy === CONNECTION_PRIVACY.NOBODY) {
      throw new AppError(
        'This parent is not accepting connection requests',
        403,
        'CONNECTION_NOT_ALLOWED'
      );
    }

    const isBlocked = await safetyService.isBlocked(requesterParentId, recipientParentId);
    if (isBlocked) {
      throw new AppError('Cannot interact with this profile', 403, 'BLOCKED_INTERACTION');
    }

    // A pending/accepted connection already exists: nothing to send, no quota needed
    const existingConnection = await connectionRepository.findActiveBetween(
      requesterParentId,
      recipientParentId
    );
    if (!existingConnection) {
      await subscriptionService.checkAndConsumeQuota(requesterParentId, 'connectionRequest', false);
    }

    return { existingConnection };
  }

  /**
   * Send a connection request, consuming one monthly connection request quota unit.
   * - If the recipient already sent a pending request to the requester, both parents want
   *   to connect: the pending request is accepted instead (mutual match, no quota used).
   * - Otherwise returns the existing connection when the pair is already pending/accepted.
   *
   * @param {string|ObjectId} requesterParentId
   * @param {string|ObjectId} recipientParentId
   * @returns {Promise<{connection: Object, isNew: boolean, isMatched: boolean}>}
   */
  async sendConnectionRequest(requesterParentId, recipientParentId) {
    const { existingConnection } = await this.validateConnectionRequest(
      requesterParentId,
      recipientParentId
    );
    if (existingConnection) {
      const isIncomingRequest =
        existingConnection.status === CONNECTION_STATUS.PENDING &&
        existingConnection.recipientId.toString() === requesterParentId.toString();

      if (isIncomingRequest) {
        const accepted = await connectionRepository.acceptPendingById(existingConnection._id);
        if (accepted) {
          await emitConnectionEvent(CONNECTION_EVENTS.ACCEPTED, {
            parentIds: accepted.parents.map((id) => id.toString()),
          });
          return { connection: accepted, isNew: false, isMatched: true };
        }
      }

      return { connection: existingConnection, isNew: false, isMatched: false };
    }

    await subscriptionService.checkAndConsumeQuota(requesterParentId, 'connectionRequest', true);

    try {
      const connection = await connectionRepository.createRequest(
        requesterParentId,
        recipientParentId
      );
      return { connection, isNew: true, isMatched: false };
    } catch (error) {
      // Concurrent request for the same pair hit the unique pairKey index
      if (error.code === 11000) {
        const connection = await connectionRepository.findActiveBetween(
          requesterParentId,
          recipientParentId
        );
        return { connection, isNew: false, isMatched: false };
      }
      throw error;
    }
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
