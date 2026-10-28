import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { CONNECTION_PRIVACY } from '../parent/parent.constants.js';
import { RescheduleResponseDTO } from '../playdate/playdate.dto.js';

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

const toId = (val) => (val?._id || val)?.toString() || null;

export class AdminPlaydateDTO {
  static toListItem(playdate) {
    if (!playdate) return null;

    const hostParent = playdate.hostParentId && typeof playdate.hostParentId === 'object'
      ? {
          id: toId(playdate.hostParentId),
          fullName: playdate.hostParentId.fullName || '',
          avatarUrl: playdate.hostParentId.avatarUrl || '',
          isVerified: Boolean(playdate.hostParentId.verification?.isVerifiedParent),
        }
      : null;

    const hostChild = playdate.hostChildId && typeof playdate.hostChildId === 'object'
      ? {
          id: toId(playdate.hostChildId),
          displayName: playdate.hostChildId.displayName || '',
          dateOfBirth: playdate.hostChildId.dateOfBirth,
          gender: playdate.hostChildId.gender,
        }
      : null;

    return {
      id: toId(playdate),
      activity: playdate.activity || '',
      scheduledDate: playdate.scheduledDate,
      time: playdate.time || '',
      location: playdate.location || null,
      locationName: playdate.location?.name || '',
      host: {
        parent: hostParent,
        child: hostChild,
      },
      numberOfParticipants: (playdate.participants || []).length,
      status: playdate.status,
      createdAt: playdate.createdAt,
    };
  }

  static toResponseList(items) {
    if (!Array.isArray(items)) return [];
    return items.map((p) => AdminPlaydateDTO.toListItem(p));
  }

  static toDetailResponse(playdate, pendingReschedule = null) {
    if (!playdate) return null;

    const hostParent = playdate.hostParentId && typeof playdate.hostParentId === 'object'
      ? {
          id: toId(playdate.hostParentId),
          userId: toId(playdate.hostParentId.userId),
          fullName: playdate.hostParentId.fullName || '',
          avatarUrl: playdate.hostParentId.avatarUrl || '',
          isVerified: Boolean(playdate.hostParentId.verification?.isVerifiedParent),
          location: toArea(playdate.hostParentId.location),
        }
      : null;

    const hostChild = playdate.hostChildId && typeof playdate.hostChildId === 'object'
      ? {
          id: toId(playdate.hostChildId),
          displayName: playdate.hostChildId.displayName || '',
          dateOfBirth: playdate.hostChildId.dateOfBirth,
          gender: playdate.hostChildId.gender,
          interests: playdate.hostChildId.interests || [],
        }
      : null;

    const participants = (playdate.participants || []).map((p) => ({
      parentId: toId(p.parentId),
      parent: p.parentId && typeof p.parentId === 'object'
        ? {
            id: toId(p.parentId),
            userId: toId(p.parentId.userId),
            fullName: p.parentId.fullName || '',
            avatarUrl: p.parentId.avatarUrl || '',
            isVerified: Boolean(p.parentId.verification?.isVerifiedParent),
          }
        : null,
      childId: toId(p.childId),
      child: p.childId && typeof p.childId === 'object'
        ? {
            id: toId(p.childId),
            displayName: p.childId.displayName || '',
            dateOfBirth: p.childId.dateOfBirth,
            gender: p.childId.gender,
          }
        : null,
      status: p.status,
      invitedAt: p.invitedAt || null,
      respondedAt: p.respondedAt || null,
    }));

    const cancellation = playdate.cancellation
      ? {
          cancelledBy: toId(playdate.cancellation.cancelledBy),
          cancelledByAdmin: Boolean(playdate.cancellation.cancelledByAdmin),
          reason: playdate.cancellation.reason || '',
          cancelledAt: playdate.cancellation.cancelledAt || null,
        }
      : null;

    return {
      id: toId(playdate),
      activity: playdate.activity || '',
      scheduledDate: playdate.scheduledDate,
      time: playdate.time || '',
      durationMinutes: playdate.durationMinutes ?? 120,
      location: playdate.location || null,
      note: playdate.note || '',
      status: playdate.status,
      host: {
        parent: hostParent,
        child: hostChild,
      },
      participants,
      numberOfParticipants: participants.length,
      cancellation,
      completedAt: playdate.completedAt || null,
      pendingReschedule: pendingReschedule ? RescheduleResponseDTO.toResponse(pendingReschedule) : null,
      createdAt: playdate.createdAt,
      updatedAt: playdate.updatedAt,
    };
  }
}

export class AdminConnectionDTO {
  static formatParent(parent) {
    if (!parent || typeof parent !== 'object') return null;
    const userObj = parent.userId && typeof parent.userId === 'object' ? parent.userId : null;
    return {
      id: toId(parent),
      fullName: parent.fullName || '',
      avatarUrl: parent.avatarUrl || '',
      userId: toId(parent.userId),
      email: userObj?.email || '',
      isActive: userObj?.isActive ?? true,
      isVerified: Boolean(parent.verification?.isVerifiedParent),
      location: toArea(parent.location),
      bio: parent.bio || '',
    };
  }

  /**
   * Children matched on the connection (archived ones are kept and flagged, the admin sees the whole history)
   */
  static formatChildPair(pair) {
    return {
      children: (pair.childIds || []).map((child) =>
        child && typeof child === 'object'
          ? {
              id: toId(child),
              parentId: toId(child.parentId),
              displayName: child.displayName || '',
              age: calculateAgeYears(child.dateOfBirth),
              gender: child.gender,
              isArchived: child.isArchived || false,
            }
          : { id: toId(child), parentId: null, displayName: '', age: null, gender: null, isArchived: false }
      ),
      source: pair.source,
      matchScore: pair.matchScore ?? null,
      createdAt: pair.createdAt || null,
    };
  }

  static toListItem(conn) {
    if (!conn) return null;

    return {
      id: toId(conn),
      requester: AdminConnectionDTO.formatParent(conn.requesterId),
      recipient: AdminConnectionDTO.formatParent(conn.recipientId),
      status: conn.status,
      connectedAt: conn.connectedAt || null,
      declinedAt: conn.declinedAt || null,
      removedAt: conn.removedAt || null,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    };
  }

  static toResponseList(items) {
    if (!Array.isArray(items)) return [];
    return items.map((c) => AdminConnectionDTO.toListItem(c));
  }

  static toDetailResponse(conn) {
    if (!conn) return null;

    return {
      id: toId(conn),
      requester: AdminConnectionDTO.formatParent(conn.requesterId),
      recipient: AdminConnectionDTO.formatParent(conn.recipientId),
      status: conn.status,
      connectedAt: conn.connectedAt || null,
      declinedAt: conn.declinedAt || null,
      removedAt: conn.removedAt || null,
      removalReason: conn.removalReason || null,
      removedByAdmin: Boolean(conn.removedByAdmin),
      childPairs: (conn.childPairs || []).map((pair) => AdminConnectionDTO.formatChildPair(pair)),
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    };
  }
}
