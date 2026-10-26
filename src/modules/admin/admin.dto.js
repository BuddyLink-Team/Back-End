import { RescheduleResponseDTO } from '../playdate/playdate.dto.js';

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

    const participantCount = (playdate.participants || []).length;

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
      numberOfParticipants: participantCount,
      participantCount,
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
          location: playdate.hostParentId.location || null,
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

    const participantCount = participants.length;

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
      numberOfParticipants: participantCount,
      participantCount,
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
      location: parent.location || null,
      bio: parent.bio || '',
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
      childPairs: conn.childPairs || [],
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    };
  }
}
