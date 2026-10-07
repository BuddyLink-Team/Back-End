import safetyService from './safety.service.js';
import { successResponse } from '../../shared/response/index.js';

class SafetyController {
  async blockUser(req, res, next) {
    try {
      const targetParentId = req.body.blockedId || req.body.targetParentId;
      const { reason } = req.body;
      const block = await safetyService.blockUser(req.userId, targetParentId, reason);
      return successResponse(res, block, 'User blocked successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  async unblockUser(req, res, next) {
    try {
      const targetParentId = req.params.blockedId || req.body.blockedId;
      const result = await safetyService.unblockUser(req.userId, targetParentId);
      return successResponse(res, result, 'User unblocked successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  async createReport(req, res, next) {
    try {
      const report = await safetyService.createReport(req.userId, req.body);
      return successResponse(res, report, 'Report submitted successfully', 201);
    } catch (error) {
      next(error);
    }
  }
}

export const safetyController = new SafetyController();
export default safetyController;
