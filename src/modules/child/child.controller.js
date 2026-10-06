import childService from './child.service.js';
import { successResponse } from '../../shared/response/index.js';

class ChildController {
  async createChild(req, res, next) {
    try {
      const child = await childService.createChild(req.userId, req.body);
      return successResponse(res, child, 'Child profile created successfully', 201);
    } catch (error) {
      return next(error);
    }
  }

  async getMyChildren(req, res, next) {
    try {
      const children = await childService.getMyChildren(req.userId);
      return successResponse(res, children, 'Child profiles retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildById(req, res, next) {
    try {
      const child = await childService.getChildById(req.userId, req.params.id);
      return successResponse(res, child, 'Child profile details retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateChild(req, res, next) {
    try {
      const child = await childService.updateChild(req.userId, req.params.id, req.body);
      return successResponse(res, child, 'Child profile updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async deleteChild(req, res, next) {
    try {
      const result = await childService.deleteChild(req.userId, req.params.id);
      return successResponse(res, result, 'Child profile deleted successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/children/:id/public-profile
   * Returns the public profile of a child
   */
  async getPublicProfile(req, res, next) {
    try {
      const profile = await childService.getPublicProfile(req.userId, req.params.id);
      return successResponse(res, profile, 'Public profile retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new ChildController();
