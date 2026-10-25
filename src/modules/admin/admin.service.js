import adminRepository from './admin.repository.js';
import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import authService from '../auth/auth.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import {
  AdminUserListItemDTO,
  AdminUserDetailDTO,
  AdminChildListItemDTO,
  AdminChildDetailDTO,
} from './admin.dto.js';

class AdminService {
  /**
   * Get paginated parent users with joined Parent profile and metrics
   * @param {Object} queryParams
   */
  async getUsers(queryParams) {
    const result = await adminRepository.findUsersPaginated(queryParams);
    return {
      items: AdminUserListItemDTO.toResponseList(result.items),
      pagination: result.pagination,
    };
  }

  /**
   * Get full details of a parent user, including children and subscription
   * @param {string} userId
   */
  async getUserDetail(userId) {
    const user = await userService.getUserById(userId);
    if (!user || user.deletedAt) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    const children = await childService.getAllChildrenByParentId(parent._id);
    const subscription = await subscriptionService.getSubscriptionByParentId(parent._id);

    return AdminUserDetailDTO.toResponse({
      user,
      parent,
      children,
      subscription,
    });
  }

  /**
   * Update active status of a user (lock / unlock).
   * Locking revokes all active refresh tokens for the user.
   * Admins cannot lock themselves or other admins.
   * @param {string} adminUserId
   * @param {string} targetUserId
   * @param {{ isActive: boolean, reason?: string }} data
   */
  async updateUserStatus(adminUserId, targetUserId, { isActive, reason }) {
    if (adminUserId && targetUserId.toString() === adminUserId.toString()) {
      throw new AppError('Admins cannot lock themselves', 403, 'CANNOT_LOCK_SELF');
    }

    const targetUser = await userService.getUserById(targetUserId);
    if (!targetUser || targetUser.deletedAt) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (targetUser.role === USER_ROLES.ADMIN) {
      throw new AppError('Admins cannot lock other admins', 403, 'CANNOT_LOCK_ADMIN');
    }

    const boolActive = isActive === true || isActive === 'true';
    await userService.updateById(targetUserId, { isActive: boolActive });

    if (!boolActive) {
      await authService.revokeAllUserRefreshTokens(targetUserId);
    }

    return {
      id: targetUser._id,
      isActive: boolActive,
      reason: reason ? reason.trim() : null,
    };
  }

  /**
   * Get paginated child profiles joined with parent name
   * @param {Object} queryParams
   */
  async getChildren(queryParams) {
    const result = await adminRepository.findChildrenPaginated(queryParams);
    return {
      items: AdminChildListItemDTO.toResponseList(result.items),
      pagination: result.pagination,
    };
  }

  /**
   * Get full details of a child profile with parent summary
   * @param {string} childId
   */
  async getChildDetail(childId) {
    const child = await childService.getChildByIdRaw(childId);
    if (!child) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    let parent = null;
    let user = null;
    if (child.parentId) {
      parent = await parentService.getParentById(child.parentId);
      if (parent?.userId) {
        user = await userService.getUserById(parent.userId).catch(() => null);
      }
    }

    return AdminChildDetailDTO.toResponse({
      child,
      parent,
      user,
    });
  }

  /**
   * Get payment history for a parent
   * @param {{ parentId: string, page?: number, limit?: number }} params
   */
  async getPayments({ parentId, page, limit }) {
    return subscriptionService.getPaymentHistory(parentId, { page, limit });
  }
}

export default new AdminService();
