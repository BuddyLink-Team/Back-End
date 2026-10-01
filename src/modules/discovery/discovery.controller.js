import discoveryService from './discovery.service.js';
import { successResponse } from '../../shared/response/index.js';

class DiscoveryController {
  /**
   * GET /api/v1/discovery
   * Retrieve discovery profiles with Smart Matching scores
   */
  async getDiscoveryProfiles(req, res, next) {
    try {
      const result = await discoveryService.getDiscoveryProfiles(req.userId, req.query);
      return successResponse(res, result, 'Discovery profiles retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/discovery/swipe
   * Record a swipe action (Like or Pass) on a child profile
   */
  async swipeProfile(req, res, next) {
    try {
      const { targetChildId, isLike } = req.body;
      const result = await discoveryService.swipeProfile(req.userId, targetChildId, isLike);
      return successResponse(res, result, 'Swipe recorded successfully', 201);
    } catch (error) {
      return next(error);
    }
  }
}

export default new DiscoveryController();
