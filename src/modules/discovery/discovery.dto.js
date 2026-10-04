/**
 * Shape discovery profile data for API responses
 */
export class DiscoveryProfileDTO {
  /**
   * Calculate age in years from a date of birth
   * @param {Date} dateOfBirth
   * @returns {number|null}
   */
  static calculateAge(dateOfBirth) {
    if (!dateOfBirth) return null;
    const birthDate = new Date(dateOfBirth);
    const diffMs = Date.now() - birthDate.getTime();
    const ageDt = new Date(diffMs);
    return Math.abs(ageDt.getUTCFullYear() - 1970);
  }

  /**
   * Transform a single discovery profile into API response shape
   * @param {Object} child - Child document
   * @param {Object} parent - Parent document
   * @param {number} matchScore - Calculated match score (0-100)
   * @param {number} distanceKm - Distance in kilometers
   * @param {number} matchedInterestsCount - Number of shared interests
   * @returns {Object}
   */
  static toResponse(child, parent, matchScore, distanceKm, matchedInterestsCount) {
    return {
      childId: child._id,
      parentId: parent._id,
      displayName: child.displayName,
      age: DiscoveryProfileDTO.calculateAge(child.dateOfBirth),
      gender: child.gender,
      avatarUrl: child.avatarUrl || '',
      interests: child.interests || [],
      favoriteActivities: child.favoriteActivities || [],
      personality: child.personality || [],
      parent: {
        fullName: parent.fullName,
        avatarUrl: parent.avatarUrl || '',
        bio: parent.bio || '',
        area: parent.location?.area || '',
        city: parent.location?.city || '',
        isVerifiedParent: parent.verification?.isVerifiedParent || false,
        preferences: parent.preferences || {},
      },
      matchScore,
      distanceKm: Math.round(distanceKm * 10) / 10,
      matchedInterestsCount,
    };
  }

  /**
   * Transform a list of discovery profiles into API response shape
   * @param {Array<{child, parent, matchScore, distanceKm, matchedInterestsCount}>} profiles
   * @returns {Array<Object>}
   */
  static toResponseList(profiles) {
    if (!Array.isArray(profiles)) return [];
    return profiles.map((p) =>
      DiscoveryProfileDTO.toResponse(p.child, p.parent, p.matchScore, p.distanceKm, p.matchedInterestsCount)
    );
  }
}
