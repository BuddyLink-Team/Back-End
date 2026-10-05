import parentService from './parent.service.js';
import userService from '../user/user.service.js';
import { successResponse } from '../../shared/response/index.js';

class ParentController {
  async getMyProfile(req, res, next) {
    try {
      const dto = await parentService.getMyProfile(req.user);
      return successResponse(res, dto, 'Parent profile retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Alias of PUT /user/me for parents: both endpoints share the same update flow
   * (including phone change handling) so they cannot drift apart.
   */
  async updateProfile(req, res, next) {
    try {
      const dto = await userService.updateMyProfile(req.userId, req.body);
      return successResponse(res, dto, 'Parent profile updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateAvatar(req, res, next) {
    try {
      const result = await parentService.updateAvatar(req.userId, req.file?.buffer, req.file?.mimetype);
      return successResponse(res, result, 'Avatar updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateOnboardingPreferences(req, res, next) {
    try {
      const { location, preferences } = req.body;
      const dto = await parentService.updateOnboardingPreferences(req.user, {
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
