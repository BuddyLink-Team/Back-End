import { calculateAgeYears } from '../../shared/helpers/age.helper.js';

export class ChildPublicProfileDTO {
  /**
   * Shape a child document (with populated parentId) into a safe public-facing response.
   * Visibility (hidden / blocked parents) is enforced by ChildService before shaping.
   * @param {Object} child - Mongoose lean document with parentId populated
   * @param {string} [connectionStatus='none'] - VIEWER_CONNECTION_STATUS between the viewer and this parent
   * @returns {Object}
   */
  static toResponse(child, connectionStatus = 'none') {
    const parent = child.parentId || {};

    const ageYears = calculateAgeYears(child.dateOfBirth);

    return {
      childId: child._id,
      displayName: child.displayName,
      age: ageYears,
      gender: child.gender,
      interests: child.interests || [],
      favoriteActivities: child.favoriteActivities || [],
      personality: child.personality || [],
      connectionStatus,
      parent: {
        fullName: parent.fullName || null,
        avatarUrl: parent.avatarUrl || null,
        bio: parent.bio || null,
        area: parent.location?.area || parent.location?.city || null,
        isVerifiedParent: parent.verification?.isVerifiedParent || false,
        isEmailVerified: parent.verification?.isEmailVerified || false,
        isPhoneVerified: parent.verification?.isPhoneVerified || false,
        preferences: {
          preferredLocations: parent.preferences?.preferredLocations || [],
          preferredPlaydateDays: parent.preferences?.preferredPlaydateDays || [],
          preferredTimeSlots: parent.preferences?.preferredTimeSlots || [],
        },
      },
    };
  }
}

export class ChildResponseDTO {
  /**
   * @param {Object} child
   * @param {Set<string>} [lockedIds] - Children locked by the Free plan (see ChildService.getLockedChildIds)
   */
  static toResponse(child, lockedIds = null) {
    if (!child) return null;

    const age = calculateAgeYears(child.dateOfBirth);

    return {
      id: child._id,
      parentId: child.parentId,
      displayName: child.displayName,
      dateOfBirth: child.dateOfBirth,
      age,
      gender: child.gender,
      interests: child.interests || [],
      favoriteActivities: child.favoriteActivities || [],
      personality: child.personality || [],
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
      // Past the Free plan's child limit: visible and editable, but not usable for discovery or playdates
      isLocked: lockedIds ? lockedIds.has(child._id.toString()) : false,
    };
  }

  static toResponseList(children, lockedIds = null) {
    if (!Array.isArray(children)) return [];
    return children.map((c) => ChildResponseDTO.toResponse(c, lockedIds));
  }
}
