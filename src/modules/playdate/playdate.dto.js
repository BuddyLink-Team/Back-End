/**
 * Playdate Data Transfer Object
 */
export class PlaydateResponseDTO {
  static toResponse(playdate, currentParentId = null) {
    if (!playdate) return null;

    const parentIdStr = currentParentId ? currentParentId.toString() : null;
    const hostParentIdStr = playdate.hostParentId?._id
      ? playdate.hostParentId._id.toString()
      : playdate.hostParentId?.toString();
    const isHost = Boolean(parentIdStr && hostParentIdStr === parentIdStr);

    let myParticipantStatus = isHost ? 'host' : null;
    if (!isHost && Array.isArray(playdate.participants)) {
      const match = playdate.participants.find(
        (p) => (p.parentId?._id || p.parentId)?.toString() === parentIdStr
      );
      if (match) {
        myParticipantStatus = match.status;
      }
    }

    // Determine Stitch displayStatus: 'pending' | 'confirmed' | 'completed' | 'cancelled'
    let displayStatus = playdate.status;
    if (playdate.status === 'upcoming') {
      if (myParticipantStatus === 'pending') {
        displayStatus = 'pending';
      } else if (isHost && playdate.participants?.some((p) => p.status === 'pending')) {
        displayStatus = 'pending';
      } else {
        displayStatus = 'confirmed';
      }
    }

    // Format host child details
    const hostChild = playdate.hostChildId && typeof playdate.hostChildId === 'object'
      ? {
          id: playdate.hostChildId._id?.toString() || playdate.hostChildId.id,
          displayName: playdate.hostChildId.displayName,
          dateOfBirth: playdate.hostChildId.dateOfBirth,
          gender: playdate.hostChildId.gender,
          interests: playdate.hostChildId.interests || [],
          favoriteActivities: playdate.hostChildId.favoriteActivities || [],
          personality: playdate.hostChildId.personality || [],
        }
      : { id: playdate.hostChildId?.toString() };

    // Format host parent details
    const hostParent = playdate.hostParentId && typeof playdate.hostParentId === 'object'
      ? {
          id: playdate.hostParentId._id?.toString() || playdate.hostParentId.id,
          fullName: playdate.hostParentId.fullName,
          avatarUrl: playdate.hostParentId.avatarUrl || '',
          isVerified: Boolean(playdate.hostParentId.verification?.isVerifiedParent),
          location: playdate.hostParentId.location || null,
        }
      : { id: playdate.hostParentId?.toString() };

    // Format participants
    const participants = (playdate.participants || []).map((p) => ({
      parentId: (p.parentId?._id || p.parentId)?.toString(),
      parent: p.parentId && typeof p.parentId === 'object'
        ? {
            id: (p.parentId._id || p.parentId.id)?.toString(),
            fullName: p.parentId.fullName,
            avatarUrl: p.parentId.avatarUrl || '',
            isVerified: Boolean(p.parentId.verification?.isVerifiedParent),
          }
        : null,
      childId: (p.childId?._id || p.childId)?.toString(),
      child: p.childId && typeof p.childId === 'object'
        ? {
            id: (p.childId._id || p.childId.id)?.toString(),
            displayName: p.childId.displayName,
            dateOfBirth: p.childId.dateOfBirth,
            gender: p.childId.gender,
            interests: p.childId.interests || [],
          }
        : null,
      status: p.status,
      invitedAt: p.invitedAt,
      respondedAt: p.respondedAt,
    }));

    return {
      id: playdate._id?.toString() || playdate.id,
      hostParentId: hostParentIdStr,
      hostParent,
      hostChildId: playdate.hostChildId?._id?.toString() || playdate.hostChildId?.toString(),
      hostChild,
      participants,
      scheduledDate: playdate.scheduledDate,
      time: playdate.time,
      activity: playdate.activity,
      location: playdate.location,
      note: playdate.note || '',
      status: playdate.status,
      displayStatus,
      isHost,
      myParticipantStatus,
      cancellation: playdate.cancellation || null,
      completedAt: playdate.completedAt || null,
      chatConversationId: playdate.chatConversationId?.toString() || null,
      createdAt: playdate.createdAt,
      updatedAt: playdate.updatedAt,
    };
  }

  static toResponseList(playdates, currentParentId = null) {
    if (!Array.isArray(playdates)) return [];
    return playdates.map((p) => PlaydateResponseDTO.toResponse(p, currentParentId));
  }
}
