import connectionService from './connection.service.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { successResponse } from '../../shared/response/index.js';
import ConnectionDTO from './connection.dto.js';

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
  /**
   * GET /api/v1/connections?status=&direction=&search=&page=&limit=
   */
  async getConnections(req, res, next) {
    try {
      const { status, direction, search, page, limit } = req.query;
      const parentId = await resolveParentId(req.userId);
      const { items, pagination } = await connectionService.getConnections(parentId, {
        status,
        direction,
        search,
        page,
        limit,
      });
      return successResponse(
        res,
        { items: ConnectionDTO.toResponseList(items, parentId), pagination },
        'Connections retrieved successfully',
        200
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/connections  { recipientId }
   * Same rules as a discovery Like: quota, blocks, privacy, and an incoming request becomes a match
   */
  async createConnectionRequest(req, res, next) {
    try {
      const { recipientId } = req.body;
      const parentId = await resolveParentId(req.userId);
      const result = await connectionService.sendConnectionRequest(parentId, recipientId);
      const message = result.isMatched ? 'Connection request accepted' : 'Connection request sent successfully';
      return successResponse(
        res,
        { ...result, connection: ConnectionDTO.toResponse(result.connection, parentId) },
        message,
        result.isNew ? 201 : 200
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/connections/:id/accept
   */
  async acceptConnectionRequest(req, res, next) {
    try {
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.acceptConnectionRequest(req.params.id, parentId);
      return successResponse(res, ConnectionDTO.toResponse(connection, parentId), 'Connection request accepted', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/connections/:id/decline
   */
  async declineConnectionRequest(req, res, next) {
    try {
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.declineConnectionRequest(req.params.id, parentId);
      return successResponse(res, ConnectionDTO.toResponse(connection, parentId), 'Connection request declined', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * DELETE /api/v1/connections/:id  (remove a connection, or cancel a request the parent sent)
   */
  async removeConnection(req, res, next) {
    try {
      const parentId = await resolveParentId(req.userId);
      const connection = await connectionService.removeConnection(req.params.id, parentId);
      return successResponse(res, ConnectionDTO.toResponse(connection, parentId), 'Connection removed', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new ConnectionController();
