import { ChildResponseDTO } from '../child/child.dto.js';
import { calculateAgeYears } from '../../shared/helpers/age.helper.js';

const toId = (value) => (value?._id || value)?.toString() ?? null;

/**
 * Public card of the other parent: only the area / city of the location (never the street address
 * or the coordinates), the verified flag and the playdate preferences shown on the quick profile.
 */
const toParentCard = (parent) => {
  if (!parent || typeof parent !== 'object' || !parent._id) return null;
  return {
    id: toId(parent),
    fullName: parent.fullName,
    avatarUrl: parent.avatarUrl || null,
    location: {
      area: parent.location?.area || null,
      city: parent.location?.city || null,
    },
    isVerifiedParent: Boolean(parent.verification?.isVerifiedParent),
    preferences: {
      preferredPlaydateDays: parent.preferences?.preferredPlaydateDays || [],
      preferredTimeSlots: parent.preferences?.preferredTimeSlots || [],
      preferredLocations: parent.preferences?.preferredLocations || [],
    },
    child: parent.child ? ChildResponseDTO.toResponse(parent.child) : null,
  };
};

// Child shown in a pair: age only, never the date of birth
const toPairChild = (child) => ({
  id: toId(child),
  displayName: child.displayName,
  age: calculateAgeYears(child.dateOfBirth),
  gender: child.gender || null,
});

/**
 * Child pairs relative to the viewer (myChild / partnerChild). Expects populated pairs
 * (ConnectionService.populateChildPairs); pairs that are not populated are left out.
 */
const toChildPairs = (childPairs, viewerId) => {
  if (!viewerId) return [];
  return (childPairs || [])
    .filter((pair) => pair.childIds?.length === 2 && pair.childIds.every((child) => child?.parentId))
    .map((pair) => {
      const myChild = pair.childIds.find((child) => toId(child.parentId) === viewerId);
      const partnerChild = pair.childIds.find((child) => child !== myChild);
      if (!myChild || !partnerChild) return null;
      return {
        myChild: toPairChild(myChild),
        partnerChild: toPairChild(partnerChild),
        source: pair.source,
        matchScore: pair.matchScore ?? null,
      };
    })
    .filter(Boolean);
};

export class ConnectionDTO {
  /**
   * @param {Object} connection - Connection document (requesterId / recipientId populated or not)
   * @param {string|ObjectId} [viewerParentId] - Current parent: adds `direction` and `partner`
   */
  static toResponse(connection, viewerParentId) {
    if (!connection) return null;

    const requesterId = toId(connection.requesterId);
    const recipientId = toId(connection.recipientId);
    const viewerId = viewerParentId ? viewerParentId.toString() : null;
    const isRequester = viewerId !== null && viewerId === requesterId;
    const partner = isRequester ? connection.recipientId : connection.requesterId;

    return {
      id: toId(connection),
      status: connection.status,
      requesterId,
      recipientId,
      // incoming: the viewer received the request; outgoing: the viewer sent it
      direction: viewerId ? (isRequester ? 'outgoing' : 'incoming') : null,
      partner: viewerId ? toParentCard(partner) : null,
      childPairs: toChildPairs(connection.childPairs, viewerId),
      connectedAt: connection.connectedAt || null,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  static toResponseList(connections, viewerParentId) {
    return (connections || []).map((connection) => ConnectionDTO.toResponse(connection, viewerParentId));
  }
}

export default ConnectionDTO;
