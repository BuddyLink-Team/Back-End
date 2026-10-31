import connectionRepository from './connection.repository.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import safetyService from '../safety/safety.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/app-error.js';
import { CONNECTION_PRIVACY } from '../parent/parent.constants.js';
import { CONNECTION_STATUS, CHILD_PAIR_SOURCES, buildChildPairKey } from './connection.constants.js';
import { PAGINATION } from '../../shared/constants/index.js';
import { emitConnectionEvent, CONNECTION_EVENTS } from './connection.events.js';

/**
 * Child pair sub-document from two child ids
 * @param {string|ObjectId} childIdA
 * @param {string|ObjectId} childIdB
 * @param {string} source - CHILD_PAIR_SOURCES
 * @param {number|null} [matchScore]
 */
const toChildPair = (childIdA, childIdB, source, matchScore = null) => ({
  childIds: [childIdA.toString(), childIdB.toString()].sort(),
  pairKey: buildChildPairKey(childIdA, childIdB),
  source,
  matchScore: matchScore ?? null,
  createdAt: new Date(),
});

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
   * The accepted connection between two parents, if any
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<Object|null>}
   */
  async getAcceptedConnectionBetween(parentIdA, parentIdB) {
    return connectionRepository.findAcceptedBetween(parentIdA, parentIdB);
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
   * Admin oversight: connections across the platform counted by status
   * @returns {Promise<{ total: number, pending: number, accepted: number, declined: number, removed: number }>}
   */
  async getConnectionStats() {
    return connectionRepository.countByStatus();
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
   * Record that two children (one of each parent) are paired on a connection.
   * No-op when the pair is already there; never consumes quota.
   * @param {string|ObjectId} connectionId
   * @param {{ childIdA: string|ObjectId, childIdB: string|ObjectId, source: string, matchScore?: number|null }} pair
   * @returns {Promise<Object|null>} Updated connection, or null when the pair already existed
   */
  async addChildPair(connectionId, { childIdA, childIdB, source, matchScore = null }) {
    return connectionRepository.addChildPair(connectionId, toChildPair(childIdA, childIdB, source, matchScore));
  }

  /**
   * Add the discovery child pair (if any) to a connection, keeping the latest connection state
   * @private
   */
  async _withDiscoveryPair(connection, childPair) {
    if (!childPair || !connection) return connection;
    const updated = await this.addChildPair(connection._id, {
      childIdA: childPair.forChildId,
      childIdB: childPair.targetChildId,
      source: CHILD_PAIR_SOURCES.DISCOVERY,
      matchScore: childPair.matchScore,
    });
    return updated || connection;
  }

  /**
   * Send a connection request, consuming one monthly connection request quota unit.
   * - If the recipient already sent a pending request to the requester, both parents want
   *   to connect: the pending request is accepted instead (mutual match, no quota used).
   * - Otherwise returns the existing connection when the pair is already pending/accepted.
   * In every case the optional child pair is recorded on the connection (pairing never uses quota).
   *
   * @param {string|ObjectId} requesterParentId
   * @param {string|ObjectId} recipientParentId
   * @param {{ forChildId: string|ObjectId, targetChildId: string|ObjectId, matchScore?: number }|null} [childPair]
   *   - Requester's child and the recipient's child that were matched (discovery Like)
   * @returns {Promise<{connection: Object, isNew: boolean, isMatched: boolean}>}
   */
  async sendConnectionRequest(requesterParentId, recipientParentId, childPair = null) {
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
          // Pair first, so listeners of the event already see it
          const withPair = await this._withDiscoveryPair(accepted, childPair);
          await emitConnectionEvent(CONNECTION_EVENTS.ACCEPTED, {
            parentIds: accepted.parents.map((id) => id.toString()),
            requesterId: accepted.requesterId.toString(),
            recipientId: accepted.recipientId.toString(),
            connectionId: accepted._id.toString(),
          });
          return { connection: withPair, isNew: false, isMatched: true };
        }
      }

      const connection = await this._withDiscoveryPair(existingConnection, childPair);
      return { connection, isNew: false, isMatched: false };
    }

    await subscriptionService.checkAndConsumeQuota(requesterParentId, 'connectionRequest', true);

    try {
      const connection = await connectionRepository.createRequest(
        requesterParentId,
        recipientParentId,
        childPair
          ? [toChildPair(childPair.forChildId, childPair.targetChildId, CHILD_PAIR_SOURCES.DISCOVERY, childPair.matchScore)]
          : []
      );
      await emitConnectionEvent(CONNECTION_EVENTS.REQUESTED, {
        connectionId: connection._id.toString(),
        requesterParentId: requesterParentId.toString(),
        recipientParentId: recipientParentId.toString(),
        childPair: childPair
          ? { forChildId: childPair.forChildId.toString(), targetChildId: childPair.targetChildId.toString() }
          : null,
      });
      return { connection, isNew: true, isMatched: false };
    } catch (error) {
      // Concurrent request for the same pair hit the unique pairKey index
      if (error.code === 11000) {
        const existing = await connectionRepository.findActiveBetween(
          requesterParentId,
          recipientParentId
        );
        const connection = await this._withDiscoveryPair(existing, childPair);
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
  async _transition(connectionId, fromStatus, toStatus, extraFields = {}) {
    const updated = await connectionRepository.transitionStatus(connectionId, fromStatus, toStatus, extraFields);
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
      requesterId: accepted.requesterId.toString(),
      recipientId: accepted.recipientId.toString(),
      connectionId: accepted._id.toString(),
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
    const result = await this._transition(connectionId, fromStatus, CONNECTION_STATUS.REMOVED);
    void emitConnectionEvent(CONNECTION_EVENTS.REMOVED, {
      connectionId: connectionId.toString(),
    });
    return result;
  }

  /**
   * Remove any active (pending or accepted) connection between two parents.
   * Called when one parent blocks another.
   * @param {string|ObjectId} parentIdA
   * @param {string|ObjectId} parentIdB
   * @returns {Promise<Object>}
   */
  async removeActiveConnectionBetween(parentIdA, parentIdB) {
    return connectionRepository.removeActiveBetween(parentIdA, parentIdB);
  }

  /**
   * Replace the child ids of every pair with the active child documents (one query for all the
   * connections); pairs with an archived child are dropped.
   * @param {Array<Object>} connections
   * @returns {Promise<Array<Object>>}
   */
  async populateChildPairs(connections) {
    const childIds = connections.flatMap((connection) => (connection.childPairs || []).flatMap((pair) => pair.childIds));
    const activeChildren = await childService.getActiveChildrenByIds(childIds);
    const childrenById = new Map(activeChildren.map((child) => [child._id.toString(), child]));

    return connections.map((connection) => ({
      ...connection,
      childPairs: (connection.childPairs || [])
        .map((pair) => ({ ...pair, childIds: pair.childIds.map((id) => childrenById.get(id.toString())) }))
        .filter((pair) => pair.childIds.every(Boolean)),
    }));
  }

  /**
   * One page of a parent's connections with their active child pairs (`childPairs`).
   * Each side also keeps its first active child (`child`), shown by the cards of connections without pairs.
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

    const withPairs = await this.populateChildPairs(items);

    return {
      items: withPairs.map((connection) => ({
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

  /**
   * Admin oversight: one page of all connections, searched by parent or child name
   * @param {{ status?: string, search?: string, page: number, limit: number }} options
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async getConnectionsForAdmin({ status, search, page, limit }) {
    let searchParentIds = null;
    if (search) {
      const [byName, byChildName] = await Promise.all([
        parentService.findParentIdsByName(search),
        childService.findParentIdsByChildName(search),
      ]);
      searchParentIds = [...new Set([...byName, ...byChildName].map((id) => id.toString()))];
    }

    return connectionRepository.findPageForAdmin({ status, searchParentIds, page, limit });
  }

  /**
   * Admin oversight: full detail of a connection
   */
  async getConnectionDetailForAdmin(id) {
    const connection = await connectionRepository.findWithDetailsForAdmin(id);
    if (!connection) {
      throw new AppError('Connection not found', 404, 'CONNECTION_NOT_FOUND');
    }
    return connection;
  }

  /**
   * Admin oversight: soft-remove a pending or accepted connection
   * @param {string} id
   * @param {string} [reason]
   * @returns {Promise<Object>} Removed connection with both parents populated
   */
  async removeConnectionByAdmin(id, reason = '') {
    const connection = await connectionRepository.findById(id);
    if (!connection) {
      throw new AppError('Connection not found', 404, 'CONNECTION_NOT_FOUND');
    }

    const removableStatuses = [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED];
    if (!removableStatuses.includes(connection.status)) {
      throw new AppError('Only pending or accepted connections can be removed', 409, 'INVALID_CONNECTION_STATE');
    }

    // Applies only while the status is unchanged, so a concurrent change also answers 409 INVALID_CONNECTION_STATE
    await this._transition(id, connection.status, CONNECTION_STATUS.REMOVED, {
      removedByAdmin: true,
      ...(reason ? { removalReason: reason } : {}),
    });

    void emitConnectionEvent(CONNECTION_EVENTS.REMOVED, {
      connectionId: id.toString(),
    });

    return connectionRepository.findWithDetailsForAdmin(id);
  }

  /**
   * Connections accepted between two instants
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Promise<number>}
   */
  async countAcceptedBetween(fromDate, toDate) {
    return connectionRepository.countAcceptedBetween(fromDate, toDate);
  }

  /**
   * Count distinct parents who have an accepted connection on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countDistinctParentsWithConnectionBeforeDate(date) {
    return connectionRepository.countDistinctParentsWithConnectionBeforeDate(date);
  }

  /**
   * Get connection analytics in date range
   * @param {{ fromDate?: Date, toDate?: Date }} params
   * @returns {Promise<{ sent: number, accepted: number, declined: number, pending: number, removed: number, acceptanceRate: number }>}
   */
  async getConnectionAnalytics(params) {
    const counts = await connectionRepository.countRequestsByStatus(params);
    const acceptanceRate = counts.sent > 0 ? Number(((counts.accepted / counts.sent) * 100).toFixed(1)) : 0;
    return { ...counts, acceptanceRate };
  }
}

export const connectionService = new ConnectionService();
export default connectionService;
