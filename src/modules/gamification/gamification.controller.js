import { getMyAchievements } from './gamification.service.js';
import { successResponse } from '../../shared/response/index.js';

class GamificationController {
  async getMyAchievements(req, res, next) {
    try {
      const achievements = await getMyAchievements(req.userId);
      return successResponse(res, achievements, 'Achievements retrieved successfully');
    } catch (error) {
      return next(error);
    }
  }
}

export default new GamificationController();
