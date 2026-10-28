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
}

export default new AdminController();
