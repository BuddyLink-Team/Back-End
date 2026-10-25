import { calculateAgeYears } from '../../shared/helpers/age.helper.js';

export class AdminUserListItemDTO {
  static toResponse(item) {
    if (!item) return null;

    const parent = item.parent || {};
    const subscription = Array.isArray(item.subscription) ? item.subscription[0] : item.subscription;

    return {
      id: item._id,
      parentId: parent._id || item.parentId || null,
      fullName: parent.fullName || item.fullName || '',
      avatar: parent.avatarUrl || item.avatar || '',
      email: item.email || '',
      phone: item.phone || '',
      city: parent.location?.city || item.city || '',
      isActive: item.isActive !== undefined ? item.isActive : true,
      verification: {
        isEmailVerified: parent.verification?.isEmailVerified || false,
        isPhoneVerified: parent.verification?.isPhoneVerified || false,
        isVerifiedParent: parent.verification?.isVerifiedParent || false,
      },
      childrenCount: typeof item.childrenCount === 'number'
        ? item.childrenCount
        : (Array.isArray(item.childrenCount) ? (item.childrenCount[0]?.count ?? 0) : 0),
      currentPlan: subscription
        ? {
            planCode: subscription.planCode,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
          }
        : {
            planCode: 'free',
            status: 'active',
            startDate: item.createdAt,
            endDate: null,
          },
      createdAt: item.createdAt,
    };
  }

  static toResponseList(items) {
    if (!Array.isArray(items)) return [];
    return items.map((i) => AdminUserListItemDTO.toResponse(i));
  }
}

export class AdminUserDetailDTO {
  static toResponse({ user, parent, children = [], subscription = null }) {
    if (!user) return null;

    return {
      id: user._id,
      parentId: parent?._id || null,
      fullName: parent?.fullName || '',
      avatar: parent?.avatarUrl || '',
      bio: parent?.bio || '',
      email: user.email || '',
      phone: user.phone || '',
      location: parent?.location || { address: '', area: '', city: '' },
      isActive: user.isActive !== undefined ? user.isActive : true,
      verification: {
        isEmailVerified: parent?.verification?.isEmailVerified || false,
        isPhoneVerified: parent?.verification?.isPhoneVerified || false,
        isVerifiedParent: parent?.verification?.isVerifiedParent || false,
      },
      children: children.map((child) => ({
        id: child._id,
        displayName: child.displayName,
        dateOfBirth: child.dateOfBirth,
        age: calculateAgeYears(child.dateOfBirth),
        gender: child.gender,
        isArchived: child.isArchived || false,
      })),
      subscription: subscription
        ? {
            planCode: subscription.planCode,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            purchasedMonths: subscription.purchasedMonths || 0,
          }
        : {
            planCode: 'free',
            status: 'active',
            startDate: user.createdAt,
            endDate: null,
            purchasedMonths: 0,
          },
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export class AdminChildListItemDTO {
  static toResponse(child) {
    if (!child) return null;

    const parent = child.parent || {};

    return {
      id: child._id,
      displayName: child.displayName,
      age: calculateAgeYears(child.dateOfBirth),
      dateOfBirth: child.dateOfBirth,
      gender: child.gender,
      parentName: parent.fullName || child.parentName || '',
      parentId: child.parentId?._id || child.parentId || null,
      parentUserId: parent.userId || child.parentUserId || null,
      isArchived: child.isArchived || false,
      createdAt: child.createdAt,
    };
  }

  static toResponseList(items) {
    if (!Array.isArray(items)) return [];
    return items.map((i) => AdminChildListItemDTO.toResponse(i));
  }
}

export class AdminChildDetailDTO {
  static toResponse({ child, parent, user }) {
    if (!child) return null;

    return {
      id: child._id,
      displayName: child.displayName,
      dateOfBirth: child.dateOfBirth,
      age: calculateAgeYears(child.dateOfBirth),
      gender: child.gender,
      interests: child.interests || [],
      favoriteActivities: child.favoriteActivities || [],
      personality: child.personality || [],
      isArchived: child.isArchived || false,
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
      parent: parent
        ? {
            parentId: parent._id,
            parentUserId: parent.userId,
            fullName: parent.fullName || '',
            avatar: parent.avatarUrl || '',
            email: user?.email || '',
            phone: user?.phone || '',
            city: parent.location?.city || '',
            isActive: user?.isActive !== undefined ? user.isActive : true,
            verification: {
              isEmailVerified: parent.verification?.isEmailVerified || false,
              isPhoneVerified: parent.verification?.isPhoneVerified || false,
              isVerifiedParent: parent.verification?.isVerifiedParent || false,
            },
          }
        : null,
    };
  }
}
