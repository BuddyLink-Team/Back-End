/**
 * Data Transfer Objects for Parent Module
 */

export class ParentProfileDTO {
  static toResponse(parent, user = null) {
    if (!parent) return null;

    return {
      id: parent._id?.toString() || parent.id,
      userId: parent.userId?.toString() || parent.userId,
      email: user?.email || parent.userId?.email || null,
      phone: user?.phone || parent.userId?.phone || null,
      fullName: parent.fullName,
      avatarUrl: parent.avatarUrl || '',
      bio: parent.bio || '',
      location: {
        address: parent.location?.address || '',
        area: parent.location?.area || '',
        city: parent.location?.city || '',
        coordinates: parent.location?.coordinates || { type: 'Point', coordinates: [0, 0] },
      },
      preferences: {
        preferredPlaydateDays: parent.preferences?.preferredPlaydateDays || [],
        preferredTimeSlots: parent.preferences?.preferredTimeSlots || [],
        preferredLocations: parent.preferences?.preferredLocations || [],
        maxDistanceKm: parent.preferences?.maxDistanceKm ?? 15,
        preferredAgeRange: parent.preferences?.preferredAgeRange || { min: 1, max: 12 },
        languages: parent.preferences?.languages || ['Vietnamese'],
        additionalNotes: parent.preferences?.additionalNotes || '',
      },
      privacySettings: {
        isProfileHidden: Boolean(parent.privacySettings?.isProfileHidden),
        connectionPrivacy: parent.privacySettings?.connectionPrivacy || 'everyone',
        messagePrivacy: parent.privacySettings?.messagePrivacy || 'connected_only',
      },
      verification: {
        isEmailVerified: Boolean(parent.verification?.isEmailVerified),
        isPhoneVerified: Boolean(parent.verification?.isPhoneVerified),
        isVerifiedParent: Boolean(parent.verification?.isVerifiedParent),
      },
      streak: {
        currentWeeklyStreak: parent.streak?.currentWeeklyStreak || 0,
        longestStreak: parent.streak?.longestStreak || 0,
        lastCompletedPlaydateWeek: parent.streak?.lastCompletedPlaydateWeek || null,
      },
      createdAt: parent.createdAt,
      updatedAt: parent.updatedAt,
    };
  }
}
