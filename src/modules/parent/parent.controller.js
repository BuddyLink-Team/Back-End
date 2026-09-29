import parentService from './parent.service.js';
import { ParentProfileDTO } from './parent.dto.js';
import { successResponse } from '../../shared/response/index.js';

class ParentController {
  async updateOnboardingPreferences(req, res, next) {
    try {
      const { location, preferences } = req.body;
      const dto = await parentService.updateOnboardingPreferences(req.userId, {
        location,
        preferences,
      });

      return successResponse(res, dto, 'Onboarding preferences updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getMyProfile(req, res, next) {
    try {
      const parent = await parentService.getParentByUserId(req.userId);
      const dto = ParentProfileDTO.toResponse(parent);
      return successResponse(res, dto, 'Parent profile retrieved', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new ParentController();
