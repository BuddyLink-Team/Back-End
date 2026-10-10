import connectionRepository from './connection.repository.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import safetyService from '../safety/safety.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { CONNECTION_PRIVACY } from '../parent/parent.constants.js';
import { CONNECTION_STATUS } from './connection.constants.js';
import { PAGINATION } from '../../shared/constants/index.js';
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

  // ---------------------------------------------------------------------------
  // Connection requests management (GET/PUT/DELETE /connections)
  // ---------------------------------------------------------------------------

  /**
   * Load a connection and check that the parent may act on it
   * @param {string|ObjectId} connectionId
   * @param {string|ObjectId} parentId
   * @param {{ recipientOnly?: boolean }} [options] - Only the recipient may accept / decline a request
   * @private
   */
  async _getOwnConnection(connectionId, parentId, { recipientOnly = false } = {}) {
    const connection = await connectionRepository.findById(connectionId);
    if (!connection) {
      throw new AppError('Connection not found', 404, 'CONNECTION_NOT_FOUND');
    }

    const isAllowed = recipientOnly
      ? connection.recipientId.toString() === parentId.toString()
      : connection.parents.some((id) => id.toString() === parentId.toString());
    if (!isAllowed) {
      throw new AppError('You are not allowed to change this connection', 403, 'UNAUTHORIZED_ACTION');
    }
    return connection;
  }

  /**
   * Move the connection to a new status, or explain why it is not in the expected one
   * @private
   */
  async _transition(connectionId, fromStatus, toStatus) {
    const updated = await connectionRepository.transitionStatus(connectionId, fromStatus, toStatus);
    if (!updated) {
      throw new AppError(`Connection is not ${fromStatus}`, 409, 'INVALID_CONNECTION_STATE');
    }
    return updated;
  }

  /**
   * Accept an incoming connection request (recipient only)
   * @param {string|ObjectId} connectionId
   * @param {string|ObjectId} parentId - Current parent
   * @returns {Promise<Object>} Accepted connection
   */
  async acceptConnectionRequest(connectionId, parentId) {
    const connection = await this._getOwnConnection(connectionId, parentId, { recipientOnly: true });
    // A block made after the request was sent forbids the connection (either direction)
    if (await safetyService.isBlocked(connection.requesterId, connection.recipientId)) {
      throw new AppError('Cannot interact with this profile', 403, 'BLOCKED_INTERACTION');
    }

    const accepted = await this._transition(connectionId, CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED);
    // Same as a discovery match: gamification updates the connection badges
    await emitConnectionEvent(CONNECTION_EVENTS.ACCEPTED, {
      parentIds: accepted.parents.map((id) => id.toString()),
    });
    return accepted;
  }

  /**
   * Decline an incoming connection request (recipient only)
   * @param {string|ObjectId} connectionId
   * @param {string|ObjectId} parentId - Current parent
   * @returns {Promise<Object>} Declined connection
   */
  async declineConnectionRequest(connectionId, parentId) {
    await this._getOwnConnection(connectionId, parentId, { recipientOnly: true });
    return this._transition(connectionId, CONNECTION_STATUS.PENDING, CONNECTION_STATUS.DECLINED);
  }

  /**
   * Remove an accepted connection (either parent), or cancel a request the parent sent
   * @param {string|ObjectId} connectionId
   * @param {string|ObjectId} parentId - Current parent
   * @returns {Promise<Object>} Removed connection
   */
  async removeConnection(connectionId, parentId) {
    const connection = await this._getOwnConnection(connectionId, parentId);
    const isOwnPendingRequest =
      connection.status === CONNECTION_STATUS.PENDING && connection.requesterId.toString() === parentId.toString();
    const fromStatus = isOwnPendingRequest ? CONNECTION_STATUS.PENDING : CONNECTION_STATUS.ACCEPTED;
    return this._transition(connectionId, fromStatus, CONNECTION_STATUS.REMOVED);
  }

  /**
   * One page of a parent's connections, each side with its first active child (`child`) for the cards.
   * Parents in a block relationship are hidden (a block forbids any interaction; unblocking shows them again).
   * @param {string|ObjectId} parentId
   * @param {Object} [filters]
   * @param {string} [filters.status] - pending | accepted | declined | removed
   * @param {'incoming'|'outgoing'} [filters.direction]
   * @param {string} [filters.search] - Name of the other parent or of their child
   * @param {number|string} [filters.page]
   * @param {number|string} [filters.limit]
   * @returns {Promise<{ items: Array<Object>, pagination: Object }>}
   */
  async getConnections(parentId, { status, direction, search, page, limit } = {}) {
    const parsedLimit = Math.min(PAGINATION.MAX_LIMIT, Math.max(1, parseInt(limit, 10) || PAGINATION.DEFAULT_LIMIT));
    const parsedPage = Math.max(PAGINATION.DEFAULT_PAGE, parseInt(page, 10) || PAGINATION.DEFAULT_PAGE);

    const searchText = search?.trim();
    const [blockedParentIds, partnerIds] = await Promise.all([
      safetyService.getBlockedParentIds(parentId),
      searchText
        ? Promise.all([
            parentService.findParentIdsByName(searchText),
            childService.findParentIdsByChildName(searchText),
          ]).then(([byName, byChildName]) => [...byName, ...byChildName])
        : undefined,
    ]);

    const { items, total } = await connectionRepository.findPageForParent(
      parentId,
      { status, direction, excludeParentIds: blockedParentIds, partnerIds },
      { page: parsedPage, limit: parsedLimit }
    );

    // First active child of every parent on the page, in one query
    const parentIdsOnPage = items.flatMap((connection) => [connection.requesterId?._id, connection.recipientId?._id]);
    const childrenByParent = await childService.getActiveChildrenByParentIds(parentIdsOnPage.filter(Boolean));
    const withChild = (party) =>
      party && { ...party, child: childrenByParent.get(party._id.toString())?.[0] || null };

    return {
      items: items.map((connection) => ({
        ...connection,
        requesterId: withChild(connection.requesterId),
        recipientId: withChild(connection.recipientId),
      })),
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
