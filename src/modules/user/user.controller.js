import userService from './user.service.js';
import authService from '../auth/auth.service.js';
import { successResponse } from '../../shared/response/index.js';
import { TokenPairDTO } from '../auth/auth.dto.js';

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
      await userService.changePassword(req.userId, {
        currentPassword,
        newPassword,
        confirmNewPassword,
      });

      // Sign out every other device (they may hold a stolen session) and keep this one signed in
      const tokens = await authService.rotateAllSessions(req.userId);

      return successResponse(
        res,
        { success: true, tokens: TokenPairDTO.toResponse(tokens) },
        'Password changed successfully',
        200
      );
    } catch (error) {
      return next(error);
    }
  }
}

export default new UserController();
