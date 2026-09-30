import parentService from './parent.service.js';
import { ParentProfileDTO } from './parent.dto.js';
import { successResponse } from '../../shared/response/index.js';

class ParentController {
  async getMyProfile(req, res, next) {
    try {
      const dto = await parentService.getMyProfile(req.userId);
      return successResponse(res, dto, 'Parent profile retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const dto = await parentService.updateProfile(req.userId, req.body);
      return successResponse(res, dto, 'Parent profile updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateAvatar(req, res, next) {
    try {
      const fileBuffer = req.file?.buffer;
      const result = await parentService.updateAvatar(req.userId, fileBuffer);
      return successResponse(res, result, 'Avatar updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

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
}

export default new ParentController();
