import connectionService from './connection.service.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { successResponse } from '../../shared/response/index.js';

/**
 * Connections reference Parent documents, while req.userId is the User id (from JWT).
 * Resolve the parent id before calling the service.
 */
const resolveParentId = async (userId) => {
  const parent = await parentService.getParentByUserId(userId);
  if (!parent) {
    throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
  }
  return parent._id;
};

class ConnectionController {
  async createConnectionRequest(req, res, next) {
    try {
      const { recipientId } = req.body;
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.createConnectionRequest(parentId, recipientId);
      return successResponse(res, connection, 'Connection request sent successfully', 201);
    } catch (error) {
      return next(error);
    }
  }

  async acceptConnectionRequest(req, res, next) {
    try {
      const { id } = req.params;
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.acceptConnectionRequest(id, parentId);
      return successResponse(res, connection, 'Connection request accepted', 200);
    } catch (error) {
      return next(error);
    }
  }

  async declineConnectionRequest(req, res, next) {
    try {
      const { id } = req.params;
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.declineConnectionRequest(id, parentId);
      return successResponse(res, connection, 'Connection request declined', 200);
    } catch (error) {
      return next(error);
    }
  }

  async removeConnection(req, res, next) {
    try {
      const { id } = req.params;
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.removeConnection(id, parentId);
      return successResponse(res, connection, 'Connection removed', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getConnections(req, res, next) {
    try {
      const { status } = req.query;
      const parentId = await resolveParentId(req.userId);
      const connections = await connectionService.getConnections(parentId, status);
      return successResponse(res, connections, 'Connections retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new ConnectionController();
