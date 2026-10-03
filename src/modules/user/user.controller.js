import userService from './user.service.js';
import { successResponse } from '../../shared/response/index.js';

class UserController {
  /**
   * Get current authenticated user profile
   */
  async getMe(req, res, next) {
    try {
      const result = await userService.getMyProfile(req.userId);
      return successResponse(res, result, 'User profile retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Update current authenticated user profile
   */
  async updateMe(req, res, next) {
    try {
      const result = await userService.updateMyProfile(req.userId, req.body);
      return successResponse(res, result, 'User profile updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Update current user avatar
   */
  async updateAvatar(req, res, next) {
    try {
      const result = await userService.updateMyAvatar(req.userId, req.file?.buffer, req.file?.mimetype);
      return successResponse(res, result, 'Avatar updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Change password for current user
   */
  async changePassword(req, res, next) {
    try {
      const { currentPassword, newPassword, confirmNewPassword } = req.body;
      const result = await userService.changePassword(req.userId, {
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
      return successResponse(res, result, 'Password changed successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new UserController();
