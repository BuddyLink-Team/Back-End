import { addMinutesToTime } from '../../shared/helpers/date.helper.js';
import { PLAYDATE_RULES, PLAYDATE_STATUS, PARTICIPANT_STATUS, PLAYDATE_DISPLAY_STATUS } from './playdate.constants.js';

// Old playdates / requests were stored without a duration
const durationOf = (value) => value ?? PLAYDATE_RULES.DEFAULT_DURATION_MINUTES;

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
    // The viewer's own children in this playdate (host child, or the invited ones: same answer for all of them)
    let myChildIds = isHost ? [(playdate.hostChildId?._id || playdate.hostChildId)?.toString()] : [];
    if (!isHost && Array.isArray(playdate.participants)) {
      const mine = playdate.participants.filter(
        (p) => (p.parentId?._id || p.parentId)?.toString() === parentIdStr
      );
      if (mine.length) {
        myParticipantStatus = mine[0].status;
        myChildIds = mine.map((p) => (p.childId?._id || p.childId)?.toString()).filter(Boolean);
      }
    }

    // Status seen by the viewer (PLAYDATE_DISPLAY_STATUS) for an upcoming playdate: confirmed only once
    // someone accepted; the host of a playdate nobody joined (all declined, or none invited) is awaiting playmates
    let displayStatus = playdate.status;
    if (playdate.status === PLAYDATE_STATUS.UPCOMING) {
      const statuses = (playdate.participants || []).map((p) => p.status);
      if (myParticipantStatus === PARTICIPANT_STATUS.PENDING || (isHost && statuses.includes(PARTICIPANT_STATUS.PENDING))) {
        displayStatus = PLAYDATE_DISPLAY_STATUS.PENDING;
      } else if (myParticipantStatus === PARTICIPANT_STATUS.DECLINED) {
        displayStatus = PLAYDATE_DISPLAY_STATUS.DECLINED;
      } else if (isHost && !statuses.includes(PARTICIPANT_STATUS.ACCEPTED)) {
        displayStatus = PLAYDATE_DISPLAY_STATUS.AWAITING_PLAYMATES;
      } else {
        displayStatus = PLAYDATE_DISPLAY_STATUS.CONFIRMED;
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
          // Only the area: never expose the host family's exact address or coordinates
          location: {
            area: playdate.hostParentId.location?.area || '',
            city: playdate.hostParentId.location?.city || '',
          },
        }
      : { id: playdate.hostParentId?.toString() };

    // Who the viewer sees: the host sees every invitee and their answer. Anyone else sees the families who
    // joined (accepted, the group chat members) and themselves, never who else was invited or declined,
    // only how many families are still invited.
    const idOf = (p) => (p.parentId?._id || p.parentId)?.toString();
    const allParticipants = playdate.participants || [];
    const seesAll = isHost || !parentIdStr;
    const visibleParticipants = seesAll
      ? allParticipants
      : allParticipants.filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED || idOf(p) === parentIdStr);
    const otherPendingCount = seesAll
      ? 0
      : new Set(allParticipants.filter((p) => p.status === PARTICIPANT_STATUS.PENDING && idOf(p) !== parentIdStr).map(idOf)).size;

    // Format participants
    const participants = visibleParticipants.map((p) => ({
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
      // Families still to answer that the viewer does not see (always 0 for the host)
      otherPendingCount,
      scheduledDate: playdate.scheduledDate,
      time: playdate.time,
      durationMinutes: durationOf(playdate.durationMinutes),
      endTime: addMinutesToTime(playdate.time, durationOf(playdate.durationMinutes)),
      activity: playdate.activity,
      location: playdate.location,
      note: playdate.note || '',
      status: playdate.status,
      displayStatus,
      isHost,
      myParticipantStatus,
      myChildId: myChildIds[0] || null,
      myChildIds,
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

/**
 * Reschedule Request Data Transfer Object
 */
export class RescheduleResponseDTO {
  /**
   * @param {Object} request
   * @param {string|ObjectId} [currentParentId] - Adds the caller's own vote (myVote) and isRequester
   */
  static toResponse(request, currentParentId = null) {
    if (!request) return null;
    const currentIdStr = currentParentId ? currentParentId.toString() : null;

    const requestedBy = request.requestedBy && typeof request.requestedBy === 'object'
      ? {
          id: request.requestedBy._id?.toString() || request.requestedBy.id,
          fullName: request.requestedBy.fullName,
          avatarUrl: request.requestedBy.avatarUrl || '',
          isVerified: Boolean(request.requestedBy.verification?.isVerifiedParent),
        }
      : { id: request.requestedBy?.toString() };

    const responses = (request.responses || []).map((r) => {
      const pIdStr = (r.parentId?._id || r.parentId?.id || r.parentId)?.toString();
      const parentObj = r.parentId && typeof r.parentId === 'object'
        ? {
            _id: (r.parentId._id || r.parentId.id)?.toString(),
            id: (r.parentId._id || r.parentId.id)?.toString(),
            fullName: r.parentId.fullName,
            avatarUrl: r.parentId.avatarUrl || '',
            isVerified: Boolean(r.parentId.verification?.isVerifiedParent),
          }
        : { _id: pIdStr, id: pIdStr };

      return {
        parentId: parentObj,
        parent: parentObj,
        status: r.status,
        respondedAt: r.respondedAt || null,
      };
    });

    const myResponse = currentIdStr
      ? responses.find((r) => r.parentId?.id === currentIdStr)
      : null;

    return {
      id: request._id?.toString() || request.id,
      playdateId: request.playdateId?.toString(),
      requestedBy,
      isRequester: Boolean(currentIdStr && requestedBy.id === currentIdStr),
      // Caller's vote: 'pending' | 'accepted' | 'declined', or null when not a voter
      myVote: myResponse ? myResponse.status : null,
      newDate: request.newDate,
      newStartTime: request.newStartTime,
      // null on requests that keep the playdate's duration
      newDurationMinutes: request.newDurationMinutes ?? null,
      newEndTime: request.newDurationMinutes
        ? addMinutesToTime(request.newStartTime, request.newDurationMinutes)
        : null,
      newLocation: request.newLocation || null,
      reason: request.reason || '',
      status: request.status,
      responses,
      resolvedAt: request.resolvedAt || null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }
}
