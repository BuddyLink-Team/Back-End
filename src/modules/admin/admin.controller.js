import adminService from './admin.service.js';
import { successResponse } from '../../shared/response/index.js';

class AdminController {
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

export const adminController = new AdminController();
export default adminController;
