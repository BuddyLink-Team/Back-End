export class UserProfileDTO {
  static toResponse(user, roleData = null) {
    if (!user) return null;

    return {
      id: user._id?.toString() || user.id,
      email: user.email,
      phone: user.phone || null,
      role: (user.role || 'parent').toLowerCase(),
      isActive: Boolean(user.isActive),
      ...(roleData ? { profile: roleData } : {}),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
