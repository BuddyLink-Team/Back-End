import { USER_ROLES } from '../../shared/constants/index.js';

export class UserProfileDTO {
  static toResponse(user, roleData = null) {
    if (!user) return null;

    return {
      id: user._id?.toString() || user.id,
      email: user.email,
      phone: user.phone || null,
      role: user.role || USER_ROLES.PARENT,
      isActive: Boolean(user.isActive),
      ...(roleData ? { profile: roleData } : {}),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
