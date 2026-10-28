import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { CONNECTION_PRIVACY } from '../parent/parent.constants.js';

// Ward and city only: the address and the coordinates are never sent to the admin portal
const toArea = (location) => ({
  area: location?.area || '',
  city: location?.city || '',
});

const toVerification = (parent) => ({
  isEmailVerified: parent?.verification?.isEmailVerified || false,
  isPhoneVerified: parent?.verification?.isPhoneVerified || false,
  isVerifiedParent: parent?.verification?.isVerifiedParent || false,
});

export class AdminUserListItemDTO {
  /**
   * @param {{ user: Object, parent: Object|null, childrenCount: number, plan: Object }} data
   */
  static toResponse({ user, parent, childrenCount, plan }) {
    return {
      id: user._id,
      fullName: parent?.fullName || '',
      avatar: parent?.avatarUrl || '',
      email: user.email || '',
      phone: user.phone || '',
      city: parent?.location?.city || '',
      isActive: user.isActive !== false,
      isProfileHidden: parent?.privacySettings?.isProfileHidden === true,
      isVerifiedParent: parent?.verification?.isVerifiedParent || false,
      childrenCount,
      currentPlan: {
        planCode: plan.planCode,
        isPremium: plan.isPremium,
        endDate: plan.endDate,
      },
      createdAt: user.createdAt,
    };
  }
}

export class AdminUserDetailDTO {
  /**
   * @param {Object} data
   * @param {Object} data.user
   * @param {Object} data.parent
   * @param {Array<Object>} data.children - Including archived ones
   * @param {Set<string>} data.lockedChildIds - Children over the Free plan limit
   * @param {Object} data.plan - subscriptionService.getEffectivePlan result
   * @param {string[]} data.loginMethods
   * @param {{ connections: number, playdates: Object, reports: Object }} data.activity
   */
  static toResponse({ user, parent, children = [], lockedChildIds = new Set(), plan, loginMethods, activity }) {
    const activeChildrenCount = children.filter((child) => !child.isArchived).length;

    return {
      id: user._id,
      parentId: parent._id,
      fullName: parent.fullName || '',
      avatar: parent.avatarUrl || '',
      bio: parent.bio || '',
      email: user.email || '',
      phone: user.phone || '',
      location: toArea(parent.location),
      isActive: user.isActive !== false,
      isProfileHidden: parent.privacySettings?.isProfileHidden === true,
      connectionPrivacy: parent.privacySettings?.connectionPrivacy || CONNECTION_PRIVACY.EVERYONE,
      loginMethods,
      verification: toVerification(parent),
      streak: {
        currentWeeklyStreak: parent.streak?.currentWeeklyStreak || 0,
        longestStreak: parent.streak?.longestStreak || 0,
      },
      activeChildrenCount,
      archivedChildrenCount: children.length - activeChildrenCount,
      children: children.map((child) => ({
        id: child._id,
        displayName: child.displayName,
        age: calculateAgeYears(child.dateOfBirth),
        gender: child.gender,
        isArchived: child.isArchived || false,
        isPlanLocked: lockedChildIds.has(child._id.toString()),
      })),
      subscription: {
        planCode: plan.planCode,
        isPremium: plan.isPremium,
        startDate: plan.startDate,
        endDate: plan.endDate,
        purchasedMonths: plan.purchasedMonths,
      },
      activity: {
        connections: activity.connections,
        playdates: activity.playdates,
        reports: activity.reports,
      },
      createdAt: user.createdAt,
    };
  }
}

export class AdminChildListItemDTO {
  /**
   * @param {{ child: Object, parent: Object|null, visibility: string }} data
   */
  static toResponse({ child, parent, visibility }) {
    return {
      id: child._id,
      displayName: child.displayName,
      age: calculateAgeYears(child.dateOfBirth),
      gender: child.gender,
      parentName: parent?.fullName || '',
      parentUserId: parent?.userId || null,
      isArchived: child.isArchived || false,
      visibility,
      createdAt: child.createdAt,
    };
  }
}

export class AdminChildDetailDTO {
  /**
   * @param {{ child: Object, parent: Object|null, user: Object|null, visibility: string }} data
   */
  static toResponse({ child, parent, user, visibility }) {
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
      visibility,
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
      parent: parent
        ? {
            parentUserId: parent.userId,
            fullName: parent.fullName || '',
            avatar: parent.avatarUrl || '',
            email: user?.email || '',
            phone: user?.phone || '',
            ...toArea(parent.location),
            isActive: user?.isActive === true,
            isProfileHidden: parent.privacySettings?.isProfileHidden === true,
            isVerifiedParent: parent.verification?.isVerifiedParent || false,
          }
        : null,
    };
  }
}
