import playdateRepository from './playdate.repository.js';
import rescheduleRepository from './reschedule.repository.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import connectionService from '../connection/connection.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import chatService from '../chat/chat.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import logger from '../../shared/logger/index.js';
import { PlaydateResponseDTO, RescheduleResponseDTO } from './playdate.dto.js';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS, RESCHEDULE_STATUS } from './playdate.constants.js';

class PlaydateService {
  /**
   * Helper to resolve parent._id from authenticated req.userId
   */
  async _getParentId(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }
    return parent._id;
  }

  /**
   * Keep the playdate group chat in sync (host + accepted participants).
   * A chat failure must not undo the playdate action, so it is only logged.
   * @private
   */
  async _syncGroupChat(playdateId) {
    try {
      await chatService.syncPlaydateConversation(playdateId);
    } catch (error) {
      logger.error(`Failed to sync group chat for playdate ${playdateId}: ${error.message}`);
    }
  }

  /**
   * Get playdate by ID (no caller check). Used by the chat module.
   * @param {string} playdateId
   */
  async getPlaydateById(playdateId) {
    if (!playdateId) {
      throw new AppError('Playdate ID is required', 400, 'PLAYDATE_ID_REQUIRED');
    }
    const playdate = await playdateRepository.findById(playdateId);
    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }
    return playdate;
  }

  /**
   * Get playdate populated with host and participants details
   * @param {string} playdateId
   */
  async getPlaydateWithDetails(playdateId) {
    if (!playdateId) {
      throw new AppError('Playdate ID is required', 400, 'PLAYDATE_ID_REQUIRED');
    }
    const playdate = await playdateRepository.findWithDetails(playdateId);
    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }
    return playdate;
  }

  /**
   * Verify that a parent is an accepted participant (or host) in the Playdate.
   * Only parents with 'accepted' status or the host are authorized to join the group chat.
   * @param {string} playdateId
   * @param {string} parentId
   * @returns {Promise<Object>} The verified playdate object
   */
  async verifyPlaydateParticipant(playdateId, parentId) {
    const playdate = await this.getPlaydateById(playdateId);
    const parentIdStr = parentId?.toString();

    // 1. Host parent is always authorized
    const hostParentIdStr = playdate.hostParentId?._id?.toString() || playdate.hostParentId?.toString();
    if (hostParentIdStr === parentIdStr) {
      return playdate;
    }

    // 2. Check participants for matching parentId and ACCEPTED status
    const participant = (playdate.participants || []).find((p) => {
      const pId = p.parentId?._id?.toString() || p.parentId?.toString();
      return pId === parentIdStr;
    });

    if (!participant) {
      throw new AppError(
        'You are not a participant of this playdate',
        403,
        'FORBIDDEN_NOT_IN_PLAYDATE'
      );
    }

    if (participant.status !== PARTICIPANT_STATUS.ACCEPTED) {
      throw new AppError(
        'Only the host and accepted participants can join the playdate group chat',
        403,
        'FORBIDDEN_PLAYDATE_CHAT_ACCESS'
      );
    }

    return playdate;
  }

  /**
   * Helper to extract unique parent IDs of host and all accepted participants
   * @param {Object} playdate
   * @returns {Array<string>}
   */
  getAcceptedParentIds(playdate) {
    const hostId = (playdate.hostParentId?._id || playdate.hostParentId).toString();
    const acceptedIds = (playdate.participants || [])
      .filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED)
      .map((p) => (p.parentId?._id || p.parentId).toString());

    return Array.from(new Set([hostId, ...acceptedIds]));
  }

  /**
   * Link playdate to a chat conversation
   * @param {string} playdateId
   * @param {string} conversationId
   */
  async updateChatConversationId(playdateId, conversationId) {
    return playdateRepository.updateChatConversationId(playdateId, conversationId);
  }

  /**
   * Get playdates for authenticated parent with status filter, counts, and pagination
   */
  async getPlaydates(userId, query = {}) {
    const parentId = await this._getParentId(userId);
    const { playdates, pagination } = await playdateRepository.findForParent(parentId, query);
    const counts = await playdateRepository.countByStatusesForParent(parentId);

    return {
      playdates: PlaydateResponseDTO.toResponseList(playdates, parentId),
      counts,
      pagination,
    };
  }

  /**
   * Get playdate by ID for the authenticated parent (host or invited participant only)
   */
  async getPlaydateForParent(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    const isHost = hostParentIdStr === parentId.toString();
    const isParticipant = playdate.participants?.some(
      (p) => (p.parentId?._id || p.parentId)?.toString() === parentId.toString()
    );

    if (!isHost && !isParticipant) {
      throw new AppError('You do not have permission to view this playdate', 403, 'FORBIDDEN');
    }

    return PlaydateResponseDTO.toResponse(playdate, parentId);
  }

  /**
   * Mark a playdate as completed (Host only, once scheduled time has arrived)
   */
  async completePlaydate(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    if (hostParentIdStr !== parentId.toString()) {
      throw new AppError('Only the host can complete the playdate', 403, 'FORBIDDEN');
    }

    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('This playdate is already completed', 400, 'ALREADY_COMPLETED');
    }

    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('Cannot complete a cancelled playdate', 400, 'INVALID_PLAYDATE_STATUS');
    }

    // Verify scheduled date and time has arrived ("Date/Time arrives -> Completed")
    const scheduled = new Date(playdate.scheduledDate);
    if (playdate.time) {
      const match = playdate.time.match(/^(\d{2}):(\d{2})/);
      if (match) {
        scheduled.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
      }
    }

    if (new Date() < scheduled) {
      throw new AppError('Playdate can only be completed once the scheduled time has arrived', 400, 'CANNOT_COMPLETE_YET');
    }

    const updated = await playdateRepository.updateById(id, {
      status: PLAYDATE_STATUS.COMPLETED,
      completedAt: new Date(),
    });

    return PlaydateResponseDTO.toResponse(updated, parentId);
  }

  /**
   * Get connected friends and their children eligible for playdate invitation
   */
  async getInvitableFriends(userId) {
    const parentId = await this._getParentId(userId);
    const connections = await connectionService.getAcceptedConnections(parentId);

    const friends = [];
    for (const conn of connections) {
      const friendParent = conn.parents.find(
        (p) => (p._id || p).toString() !== parentId.toString()
      );
      if (!friendParent) continue;

      const children = await childService.getChildrenByParentId(friendParent._id);
      friends.push({
        id: friendParent._id.toString(),
        fullName: friendParent.fullName,
        avatarUrl: friendParent.avatarUrl || '',
        isVerified: Boolean(friendParent.verification?.isVerifiedParent),
        location: friendParent.location || null,
        children: children.map((c) => ({
          id: c.id || c._id?.toString(),
          displayName: c.displayName,
          dateOfBirth: c.dateOfBirth,
          gender: c.gender,
          interests: c.interests || [],
        })),
      });
    }

    return friends;
  }

  /**
   * Create a new playdate
   */
  async createPlaydate(userId, data) {
    const hostParentId = await this._getParentId(userId);

    // 1. Verify hostChildId belongs to host
    const isHostChildValid = await childService.isChildOwnedByParent(data.hostChildId, hostParentId);
    if (!isHostChildValid) {
      throw new AppError('Child does not belong to your profile', 400, 'INVALID_HOST_CHILD');
    }

    // 2. Filter, deduplicate, and validate participants
    const rawParticipants = Array.isArray(data.participants) ? data.participants : [];

    // Prevent host from adding themselves as participant
    const hasHost = rawParticipants.some(
      (p) => (p.parentId?._id || p.parentId)?.toString() === hostParentId.toString()
    );
    if (hasHost) {
      throw new AppError('Host cannot invite themselves to a playdate', 400, 'CANNOT_INVITE_SELF');
    }

    // Deduplicate participants by parentId
    const seenParents = new Set();
    const uniqueParticipants = [];
    for (const p of rawParticipants) {
      const pid = (p.parentId?._id || p.parentId)?.toString();
      if (!seenParents.has(pid)) {
        seenParents.add(pid);
        uniqueParticipants.push(p);
      }
    }

    // Verify friendship and child ownership for all participants
    for (const p of uniqueParticipants) {
      const targetParentId = p.parentId?._id || p.parentId;
      const targetChildId = p.childId?._id || p.childId;

      const isFriend = await connectionService.areParentsConnected(hostParentId, targetParentId);
      if (!isFriend) {
        throw new AppError('Only connected friends can be invited to a playdate', 400, 'NOT_CONNECTED_FRIEND');
      }

      const isParticipantChildValid = await childService.isChildOwnedByParent(targetChildId, targetParentId);
      if (!isParticipantChildValid) {
        throw new AppError('Invited child does not belong to the selected parent', 400, 'INVALID_PARTICIPANT_CHILD');
      }
    }

    // 3. Check and consume creation quota via SubscriptionService
    await subscriptionService.checkAndConsumeQuota(hostParentId, 'playdateCreate');

    // 4. Create playdate document with whitelisted fields
    const formattedParticipants = uniqueParticipants.map((p) => ({
      parentId: p.parentId?._id || p.parentId,
      childId: p.childId?._id || p.childId,
      status: PARTICIPANT_STATUS.PENDING,
      invitedAt: new Date(),
    }));

    const { hostChildId, scheduledDate, time, activity, location, note } = data;

    const playdate = await playdateRepository.create({
      hostParentId,
      hostChildId,
      scheduledDate,
      time,
      activity,
      location,
      note: note || '',
      participants: formattedParticipants,
      status: PLAYDATE_STATUS.UPCOMING,
    });

    // 5. Create the playdate group chat (host first; invitees join once they accept)
    await this._syncGroupChat(playdate._id);

    const populated = await playdateRepository.findById(playdate._id);
    return PlaydateResponseDTO.toResponse(populated, hostParentId);
  }

  /**
   * Cancel an upcoming playdate (Host only)
   */
  async cancelPlaydate(userId, id, reason = '') {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    if (hostParentIdStr !== parentId.toString()) {
      throw new AppError('Only the host can cancel the playdate', 403, 'FORBIDDEN');
    }

    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('This playdate is already cancelled', 400, 'ALREADY_CANCELLED');
    }

    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('Cannot cancel a completed playdate', 400, 'INVALID_PLAYDATE_STATUS');
    }

    const updated = await playdateRepository.updateById(id, {
      status: PLAYDATE_STATUS.CANCELLED,
      cancellation: {
        cancelledBy: parentId,
        reason: reason || 'Cancelled by host',
        cancelledAt: new Date(),
      },
    });

    // Cancel all pending reschedule requests for this playdate
    await rescheduleRepository.updateMany(
      { playdateId: id, status: RESCHEDULE_STATUS.PENDING },
      { $set: { status: RESCHEDULE_STATUS.CANCELLED, resolvedAt: new Date() } }
    );

    return PlaydateResponseDTO.toResponse(updated, parentId);
  }

  /**
   * Respond to a playdate invitation (RSVP: accept / decline)
   */
  async respondToPlaydate(userId, id, status) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('Cannot respond to a cancelled playdate', 400, 'CANNOT_RESPOND_CANCELLED');
    }

    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('Cannot respond to a completed playdate', 400, 'CANNOT_RESPOND_COMPLETED');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    if (hostParentIdStr === parentId.toString()) {
      throw new AppError('Host does not need to RSVP to their own playdate', 400, 'HOST_CANNOT_RSVP');
    }

    const participant = playdate.participants?.find(
      (p) => (p.parentId?._id || p.parentId)?.toString() === parentId.toString()
    );

    if (!participant) {
      throw new AppError('You are not invited to this playdate', 403, 'NOT_INVITED');
    }

    if (participant.status !== PARTICIPANT_STATUS.PENDING) {
      throw new AppError('You have already responded to this invitation', 400, 'ALREADY_RESPONDED');
    }

    // Check participation quota if accepting (Free plan limit: 3/month)
    if (status === PARTICIPANT_STATUS.ACCEPTED) {
      await subscriptionService.checkAndConsumeQuota(parentId, 'playdateParticipate');
    }

    // Update participant RSVP status
    participant.status = status;
    participant.respondedAt = new Date();

    await playdate.save();

    // Accepted participants join the group chat, declined ones are kept out
    await this._syncGroupChat(id);

    const populated = await playdateRepository.findById(id);
    return PlaydateResponseDTO.toResponse(populated, parentId);
  }

  /**
   * Propose a reschedule for an upcoming playdate (Host only per Section 6.2 spec)
   */
  async createRescheduleRequest(userId, id, { newDate, newStartTime, newLocation, reason = '' }) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Can only reschedule upcoming playdates', 400, 'INVALID_PLAYDATE_STATUS_FOR_RESCHEDULE');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    const isHost = hostParentIdStr === parentId.toString();

    // Section 6.2 specification: "Host -> Reschedule"
    if (!isHost) {
      throw new AppError('Only the host can propose a reschedule', 403, 'FORBIDDEN_RESCHEDULE');
    }

    // Cancel any previous pending reschedule requests for this playdate
    await rescheduleRepository.updateMany(
      { playdateId: id, status: RESCHEDULE_STATUS.PENDING },
      { $set: { status: RESCHEDULE_STATUS.CANCELLED, resolvedAt: new Date() } }
    );

    // Identify participants who have accepted the current playdate
    const acceptedParticipants = (playdate.participants || []).filter(
      (p) => p.status === PARTICIPANT_STATUS.ACCEPTED
    );

    let initialStatus = RESCHEDULE_STATUS.PENDING;
    let resolvedAt = null;

    // Build consensus voters list (only accepted participants need to vote)
    const responses = acceptedParticipants.map((p) => ({
      parentId: p.parentId?._id || p.parentId,
      status: PARTICIPANT_STATUS.PENDING,
      respondedAt: null,
    }));

    // If there are no accepted participants yet, auto-apply the new schedule immediately
    if (responses.length === 0) {
      initialStatus = RESCHEDULE_STATUS.ACCEPTED;
      resolvedAt = new Date();

      const updateFields = {
        scheduledDate: new Date(newDate),
        time: newStartTime,
      };
      if (newLocation && newLocation.name) {
        updateFields.location = newLocation;
      }
      await playdateRepository.updateById(id, updateFields);
    }

    const rescheduleReq = await rescheduleRepository.create({
      playdateId: id,
      requestedBy: parentId,
      newDate: new Date(newDate),
      newStartTime,
      newLocation: newLocation && newLocation.name ? newLocation : playdate.location,
      reason: reason || '',
      status: initialStatus,
      responses,
      resolvedAt,
    });

    const populatedReq = await rescheduleRepository.findById(rescheduleReq._id);
    const updatedPlaydate = await playdateRepository.findById(id);

    return {
      rescheduleRequest: RescheduleResponseDTO.toResponse(populatedReq),
      isAutoApplied: initialStatus === RESCHEDULE_STATUS.ACCEPTED,
      playdate: PlaydateResponseDTO.toResponse(updatedPlaydate, parentId),
    };
  }

  /**
   * Vote on a pending reschedule request (Atomic update)
   */
  async voteRescheduleRequest(userId, id, { requestId, status }) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Can only vote on upcoming playdates', 400, 'INVALID_PLAYDATE_STATUS');
    }

    const query = {
      playdateId: id,
      status: RESCHEDULE_STATUS.PENDING,
    };
    if (requestId) {
      query._id = requestId;
    }

    const existingReq = await rescheduleRepository.findOne(query);
    if (!existingReq) {
      throw new AppError('No pending reschedule request found to vote on', 404, 'RESCHEDULE_NOT_FOUND');
    }

    // Atomic update of the individual participant's vote
    const updatedReq = await rescheduleRepository.findOneAndUpdate(
      {
        _id: existingReq._id,
        status: RESCHEDULE_STATUS.PENDING,
        responses: {
          $elemMatch: {
            parentId,
            status: PARTICIPANT_STATUS.PENDING,
          },
        },
      },
      {
        $set: {
          'responses.$.status': status,
          'responses.$.respondedAt': new Date(),
        },
      },
      { new: true }
    );

    if (!updatedReq) {
      const isVoter = existingReq.responses?.some(
        (r) => (r.parentId?._id || r.parentId)?.toString() === parentId.toString()
      );
      if (!isVoter) {
        throw new AppError('You do not have permission to vote on this reschedule request', 403, 'NOT_AUTHORIZED_TO_VOTE');
      }
      throw new AppError('You have already voted or this request is already resolved', 400, 'ALREADY_VOTED');
    }

    // Section 6.2 rule: If ANY participant declines, request is declined and old schedule kept
    if (status === PARTICIPANT_STATUS.DECLINED) {
      updatedReq.status = RESCHEDULE_STATUS.DECLINED;
      updatedReq.resolvedAt = new Date();
      await updatedReq.save();
    } else if (status === PARTICIPANT_STATUS.ACCEPTED) {
      // Check if ALL required voters accepted
      const allAccepted = updatedReq.responses.every(
        (r) => r.status === PARTICIPANT_STATUS.ACCEPTED
      );

      if (allAccepted) {
        updatedReq.status = RESCHEDULE_STATUS.ACCEPTED;
        updatedReq.resolvedAt = new Date();
        await updatedReq.save();

        // Update playdate schedule
        const updateFields = {
          scheduledDate: updatedReq.newDate,
          time: updatedReq.newStartTime,
        };
        if (updatedReq.newLocation && updatedReq.newLocation.name) {
          updateFields.location = updatedReq.newLocation;
        }
        await playdateRepository.updateById(id, updateFields);
      }
    }

    const populatedReq = await rescheduleRepository.findById(updatedReq._id);
    const updatedPlaydate = await playdateRepository.findById(id);

    return {
      rescheduleRequest: RescheduleResponseDTO.toResponse(populatedReq),
      playdate: PlaydateResponseDTO.toResponse(updatedPlaydate, parentId),
    };
  }

  /**
   * Get active or latest reschedule request for a playdate
   */
  async getRescheduleRequest(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    const isHost = hostParentIdStr === parentId.toString();
    const isParticipant = playdate.participants?.some(
      (p) => (p.parentId?._id || p.parentId)?.toString() === parentId.toString()
    );

    if (!isHost && !isParticipant) {
      throw new AppError('You do not have permission to view this playdate information', 403, 'FORBIDDEN');
    }

    const rescheduleReq = await rescheduleRepository.findLatestByPlaydateId(id);
    return RescheduleResponseDTO.toResponse(rescheduleReq);
  }
}

export const playdateService = new PlaydateService();
export default playdateService;
