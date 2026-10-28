import adminService from './admin.service.js';
import { successResponse } from '../../shared/response/index.js';

class AdminController {
  async getUsers(req, res, next) {
    try {
      const data = await adminService.getUsers(req.query);
      return successResponse(res, data, 'Parent users retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getUserStats(req, res, next) {
    try {
      const data = await adminService.getUserStats();
      return successResponse(res, data, 'Parent statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getUserDetail(req, res, next) {
    try {
      const data = await adminService.getUserDetail(req.params.id);
      return successResponse(res, data, 'Parent user detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateUserStatus(req, res, next) {
    try {
      const data = await adminService.updateUserStatus(
        req.user?._id || req.userId,
        req.params.id,
        req.body
      );
      return successResponse(res, data, 'User status updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildren(req, res, next) {
    try {
      const data = await adminService.getChildren(req.query);
      return successResponse(res, data, 'Children profiles retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildStats(req, res, next) {
    try {
      const data = await adminService.getChildStats();
      return successResponse(res, data, 'Child profile statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildDetail(req, res, next) {
    try {
      const data = await adminService.getChildDetail(req.params.id);
      return successResponse(res, data, 'Child profile detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getPayments(req, res, next) {
    try {
      const data = await adminService.getPayments(req.query);
      return successResponse(res, data, 'Payments history retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/playdates
   */
  async getPlaydates(req, res, next) {
    try {
      const data = await adminService.getPlaydates(req.query);
      return successResponse(res, data, 'Admin playdates list retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/playdates/:id
   */
  async getPlaydateDetail(req, res, next) {
    try {
      const playdate = await adminService.getPlaydateDetail(req.params.id);
      return successResponse(res, playdate, 'Admin playdate detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/playdates/:id/cancel
   */
  async cancelPlaydate(req, res, next) {
    try {
      const result = await adminService.cancelPlaydate(req.params.id, req.body?.reason);
      return successResponse(res, result, 'Playdate cancelled by admin successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/connections
   */
  async getConnections(req, res, next) {
    try {
      const data = await adminService.getConnections(req.query);
      return successResponse(res, data, 'Admin connections list retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/connections/:id
   */
  async getConnectionDetail(req, res, next) {
    try {
      const connection = await adminService.getConnectionDetail(req.params.id);
      return successResponse(res, connection, 'Admin connection detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * DELETE /api/v1/admin/connections/:id
   */
  async removeConnection(req, res, next) {
    try {
      const result = await adminService.removeConnection(req.params.id, req.body?.reason);
      return successResponse(res, result, 'Connection removed by admin successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new AdminController();
