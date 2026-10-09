import connectionRepository from './connection.repository.js';
import childRepository from '../child/child.repository.js';
import safetyService from '../safety/safety.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { CONNECTION_STATUS } from './connection.constants.js';

class ConnectionService {
  /**
   * Create a connection request
   * @param {string} requesterId
   * @param {string} recipientId
   */
  async createConnectionRequest(requesterId, recipientId) {
    if (requesterId.toString() === recipientId.toString()) {
      throw new AppError('Cannot send connection request to yourself', 400, 'INVALID_CONNECTION_REQUEST');
    }

    // Check if blocked
    const isBlocked = await safetyService.isBlocked(requesterId, recipientId);
    if (isBlocked) {
      throw new AppError('Cannot connect with this user', 403, 'ACTION_BLOCKED');
    }

    // Check existing connection
    const existingConnection = await connectionRepository.findByParents(requesterId, recipientId);
    if (existingConnection) {
      if (existingConnection.status === CONNECTION_STATUS.PENDING) {
        throw new AppError('Connection request is already pending', 400, 'CONNECTION_ALREADY_PENDING');
      }
      if (existingConnection.status === CONNECTION_STATUS.ACCEPTED) {
        throw new AppError('You are already connected with this user', 400, 'ALREADY_CONNECTED');
      }
    }

    // Consume quota
    await subscriptionService.checkAndConsumeQuota(requesterId, 'connectionRequest');

    // Create request
    return connectionRepository.create({
      parents: [requesterId, recipientId],
      requesterId,
      recipientId,
      status: CONNECTION_STATUS.PENDING,
    });
  }

  /**
   * Accept a connection request
   * @param {string} connectionId
   * @param {string} recipientId
   */
  async acceptConnectionRequest(connectionId, recipientId) {
    const connection = await connectionRepository.findById(connectionId);
    if (!connection) {
      throw new AppError('Connection not found', 404, 'CONNECTION_NOT_FOUND');
    }

    if (connection.recipientId.toString() !== recipientId.toString()) {
      throw new AppError('Unauthorized to accept this connection', 403, 'UNAUTHORIZED_ACTION');
    }

    if (connection.status !== CONNECTION_STATUS.PENDING) {
      throw new AppError('Connection is not in pending state', 400, 'INVALID_CONNECTION_STATE');
    }

    return connectionRepository.updateStatus(connectionId, CONNECTION_STATUS.ACCEPTED);
  }

  /**
   * Decline a connection request
   * @param {string} connectionId
   * @param {string} recipientId
   */
  async declineConnectionRequest(connectionId, recipientId) {
    const connection = await connectionRepository.findById(connectionId);
    if (!connection) {
      throw new AppError('Connection not found', 404, 'CONNECTION_NOT_FOUND');
    }

    if (connection.recipientId.toString() !== recipientId.toString()) {
      throw new AppError('Unauthorized to decline this connection', 403, 'UNAUTHORIZED_ACTION');
    }

    if (connection.status !== CONNECTION_STATUS.PENDING) {
      throw new AppError('Connection is not in pending state', 400, 'INVALID_CONNECTION_STATE');
    }

    return connectionRepository.updateStatus(connectionId, CONNECTION_STATUS.DECLINED);
  }

  /**
   * Remove a connection (unfriend)
   * @param {string} connectionId
   * @param {string} parentId
   */
  async removeConnection(connectionId, parentId) {
    const connection = await connectionRepository.findById(connectionId);
    if (!connection) {
      throw new AppError('Connection not found', 404, 'CONNECTION_NOT_FOUND');
    }

    if (!connection.parents.some((p) => p.toString() === parentId.toString())) {
      throw new AppError('Unauthorized to remove this connection', 403, 'UNAUTHORIZED_ACTION');
    }

    if (connection.status !== CONNECTION_STATUS.ACCEPTED) {
      throw new AppError('Connection is not accepted', 400, 'INVALID_CONNECTION_STATE');
    }

    return connectionRepository.updateStatus(connectionId, CONNECTION_STATUS.REMOVED);
  }

  /**
   * Get connections of a parent
   * @param {string} parentId
   * @param {string} status
   */
  async getConnections(parentId, status) {
    const connections = await connectionRepository.getConnectionsByParent(parentId, status);
    
    // Attach first active child of each party
    const attachChild = async (party) => {
      if (!party) return;
      const children = await childRepository.findByParentId(party._id);
      party.child = children[0] ? children[0].toObject() : null;
    };

    const enrichedConnections = await Promise.all(connections.map(async (conn) => {
      const connObj = conn.toObject();
      await Promise.all([attachChild(connObj.requesterId), attachChild(connObj.recipientId)]);
      return connObj;
    }));
    
    return enrichedConnections;
  }
}

export default new ConnectionService();
