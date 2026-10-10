import playdateRepository from './playdate.repository.js';
import rescheduleRepository from './reschedule.repository.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import connectionService from '../connection/connection.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import safetyService from '../safety/safety.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { getScheduledStart, getStartOfZonedDay } from '../../shared/helpers/date.helper.js';
import { PlaydateResponseDTO, RescheduleResponseDTO } from './playdate.dto.js';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS, RESCHEDULE_STATUS } from './playdate.constants.js';
import { emitPlaydateEvent, PLAYDATE_EVENTS } from './playdate.events.js';

const toId = (ref) => (ref?._id || ref)?.toString();

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
   * Load a playdate or fail with 404
   * @private
   */
  async _findPlaydateOrFail(id) {
    const playdate = await playdateRepository.findById(id);
    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }
    return playdate;
  }

  /**
   * @private
   */
  _isHost(playdate, parentId) {
    return toId(playdate.hostParentId) === parentId.toString();
  }

  /**
   * @private
   */
  _isInvited(playdate, parentId) {
    return (playdate.participants || []).some((p) => toId(p.parentId) === parentId.toString());
  }

  /**
   * Let other modules react to member changes (e.g. chat syncs the playdate group chat)
   * @private
   */
  async _notifyMembersChanged(playdateId) {
    await emitPlaydateEvent(PLAYDATE_EVENTS.MEMBERS_CHANGED, { playdateId: playdateId.toString() });
  }

  /**
   * Let other modules react to a completed playdate (e.g. gamification updates streaks and badges)
   * @param {Object} playdate - Completed playdate (host and participants populated or not)
   * @private
   */
  async _notifyCompleted(playdate) {
    const parentIds = [
      toId(playdate.hostParentId),
      ...(playdate.participants || [])
        .filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED)
        .map((p) => toId(p.parentId)),
    ];
    await emitPlaydateEvent(PLAYDATE_EVENTS.COMPLETED, { playdateId: toId(playdate._id), parentIds });
  }

  // ---------------------------------------------------------------------------
  // Used by the chat module
  // ---------------------------------------------------------------------------

  /**
   * Get playdate by ID (no caller check). Used by the chat module.
   * @param {string} playdateId
   */
  async getPlaydateById(playdateId) {
    if (!playdateId) {
      throw new AppError('Playdate ID is required', 400, 'PLAYDATE_ID_REQUIRED');
    }
    return this._findPlaydateOrFail(playdateId);
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

  // ---------------------------------------------------------------------------
  // Used by the gamification and rating-feedback modules
  // ---------------------------------------------------------------------------

  /**
   * Completed playdates a parent attended (as host or accepted participant), oldest first
   * @param {string|ObjectId} parentId
   * @param {{ excludeIds?: Array<string|ObjectId>, select?: string }} [options]
   * @returns {Promise<Array<Object>>}
   */
  async getCompletedPlaydatesForParent(parentId, options) {
    return playdateRepository.findCompletedForParent(parentId, options);
  }

  /**
   * Get a playdate without populated references (no caller check)
   * @param {string|ObjectId} playdateId
   * @returns {Promise<Object|null>}
   */
  async findPlaydateDocById(playdateId) {
    return playdateRepository.findDocById(playdateId);
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

    if (toId(playdate.hostParentId) === parentIdStr) {
      return playdate;
    }

    const participant = (playdate.participants || []).find((p) => toId(p.parentId) === parentIdStr);
    if (!participant) {
      throw new AppError('You are not a participant of this playdate', 403, 'FORBIDDEN_NOT_IN_PLAYDATE');
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
    const acceptedIds = (playdate.participants || [])
      .filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED)
      .map((p) => toId(p.parentId));
    return Array.from(new Set([toId(playdate.hostParentId), ...acceptedIds]));
  }

  /**
   * Link playdate to a chat conversation
   * @param {string} playdateId
   * @param {string} conversationId
   */
  async updateChatConversationId(playdateId, conversationId) {
    return playdateRepository.updateChatConversationId(playdateId, conversationId);
  }

  // ---------------------------------------------------------------------------
  // Playdate API
  // ---------------------------------------------------------------------------

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
    const playdate = await this._findPlaydateOrFail(id);

    if (!this._isHost(playdate, parentId) && !this._isInvited(playdate, parentId)) {
      throw new AppError('You do not have permission to view this playdate', 403, 'FORBIDDEN_VIEW_PLAYDATE');
    }

    return PlaydateResponseDTO.toResponse(playdate, parentId);
  }

  /**
   * Mark a playdate as completed (Host only, once the scheduled start time has arrived)
   */
  async completePlaydate(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (!this._isHost(playdate, parentId)) {
      throw new AppError('Only the host can complete the playdate', 403, 'FORBIDDEN_COMPLETE_PLAYDATE');
    }
    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('This playdate is already completed', 400, 'ALREADY_COMPLETED');
    }
    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('Cannot complete a cancelled playdate', 400, 'INVALID_PLAYDATE_STATUS');
    }

    // "Date/Time arrives -> Completed", in the business time zone
    if (new Date() < getScheduledStart(playdate.scheduledDate, playdate.time)) {
      throw new AppError('Playdate can only be completed once the scheduled time has arrived', 400, 'CANNOT_COMPLETE_YET');
    }

    const updated = await playdateRepository.updateById(id, {
      status: PLAYDATE_STATUS.COMPLETED,
      completedAt: new Date(),
    });

    // A finished playdate cannot be rescheduled anymore
    await rescheduleRepository.cancelPendingByPlaydateId(id);
    await this._notifyCompleted(updated);

    return PlaydateResponseDTO.toResponse(updated, parentId);
  }

  /**
   * Close upcoming playdates of past days (run every day at 00:00 business time).
   * The host can still complete a playdate manually; this only closes what is left:
   * - at least one accepted participant -> completed
   * - nobody accepted                   -> cancelled
   * @param {Date} [now]
   * @returns {Promise<{ completed: number, cancelled: number }>}
   */
  async closeExpiredPlaydates(now = new Date()) {
    const cutoff = getStartOfZonedDay(now);
    const expired = await playdateRepository.findUpcomingBefore(cutoff);
    const result = { completed: 0, cancelled: 0 };

    for (const playdate of expired) {
      const hasAcceptedParticipant = (playdate.participants || []).some(
        (p) => p.status === PARTICIPANT_STATUS.ACCEPTED
      );
      const update = hasAcceptedParticipant
        ? { status: PLAYDATE_STATUS.COMPLETED, completedAt: now }
        : {
            status: PLAYDATE_STATUS.CANCELLED,
            cancellation: { cancelledBy: null, reason: 'No participant accepted the invitation', cancelledAt: now },
          };

      const closed = await playdateRepository.updateIfUpcoming(playdate._id, update);
      if (!closed) continue; // the host acted in the meantime

      await rescheduleRepository.cancelPendingByPlaydateId(playdate._id);
      if (hasAcceptedParticipant) await this._notifyCompleted(closed);
      result[hasAcceptedParticipant ? 'completed' : 'cancelled'] += 1;
    }

    return result;
  }

  /**
   * Get connected friends and their children eligible for playdate invitation
   */
  async getInvitableFriends(userId) {
    const parentId = await this._getParentId(userId);
    const [connections, blockedIds] = await Promise.all([
      connectionService.getAcceptedConnections(parentId),
      safetyService.getBlockedParentIds(parentId),
    ]);
    // Parents in a block relationship (either direction) cannot be invited
    const blockedSet = new Set(blockedIds.map(String));

    const friends = [];
    for (const conn of connections) {
      const friendParent = conn.parents.find((p) => toId(p) !== parentId.toString());
      if (!friendParent || blockedSet.has(toId(friendParent))) continue;

      const children = await childService.getChildrenByParentId(friendParent._id);
      friends.push({
        id: friendParent._id.toString(),
        fullName: friendParent.fullName,
        avatarUrl: friendParent.avatarUrl || '',
        isVerified: Boolean(friendParent.verification?.isVerifiedParent),
        // Only the area: never expose a family's exact address or coordinates
        location: {
          area: friendParent.location?.area || '',
          city: friendParent.location?.city || '',
        },
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

    // 2. The playdate must start in the future
    if (getScheduledStart(data.scheduledDate, data.time) <= new Date()) {
      throw new AppError('The playdate must start in the future', 400, 'PLAYDATE_IN_PAST');
    }

    // 3. Filter, deduplicate, and validate participants
    const rawParticipants = Array.isArray(data.participants) ? data.participants : [];
    if (rawParticipants.some((p) => toId(p.parentId) === hostParentId.toString())) {
      throw new AppError('Host cannot invite themselves to a playdate', 400, 'CANNOT_INVITE_SELF');
    }

    const seenParents = new Set();
    const uniqueParticipants = rawParticipants.filter((p) => {
      const pid = toId(p.parentId);
      if (seenParents.has(pid)) return false;
      seenParents.add(pid);
      return true;
    });
    const participantParentIds = uniqueParticipants.map((p) => toId(p.parentId));

    // Safety first: no invitation between parents who blocked each other
    if (await safetyService.isBlockedWithAny(hostParentId, participantParentIds)) {
      throw new AppError('Cannot invite a parent you have a block relationship with', 403, 'BLOCKED_INTERACTION');
    }

    for (const p of uniqueParticipants) {
      const targetParentId = toId(p.parentId);
      const isFriend = await connectionService.areParentsConnected(hostParentId, targetParentId);
      if (!isFriend) {
        throw new AppError('Only connected friends can be invited to a playdate', 400, 'NOT_CONNECTED_FRIEND');
      }
      const isParticipantChildValid = await childService.isChildOwnedByParent(toId(p.childId), targetParentId);
      if (!isParticipantChildValid) {
        throw new AppError('Invited child does not belong to the selected parent', 400, 'INVALID_PARTICIPANT_CHILD');
      }
    }

    // 4. Check the creation quota first, consume it only once the playdate exists
    await subscriptionService.checkAndConsumeQuota(hostParentId, 'playdateCreate', false);

    const { hostChildId, scheduledDate, time, activity, location, note } = data;
    const playdate = await playdateRepository.create({
      hostParentId,
      hostChildId,
      scheduledDate,
      time,
      activity,
      location,
      note: note || '',
      participants: uniqueParticipants.map((p) => ({
        parentId: toId(p.parentId),
        childId: toId(p.childId),
        status: PARTICIPANT_STATUS.PENDING,
        invitedAt: new Date(),
      })),
      status: PLAYDATE_STATUS.UPCOMING,
    });

    try {
      await subscriptionService.checkAndConsumeQuota(hostParentId, 'playdateCreate', true);
    } catch (error) {
      // Concurrent request used the last unit: undo the creation
      await playdateRepository.deleteById(playdate._id);
      throw error;
    }

    // 5. Group chat starts with the host; invitees join once they accept
    await this._notifyMembersChanged(playdate._id);

    const populated = await playdateRepository.findById(playdate._id);
    return PlaydateResponseDTO.toResponse(populated, hostParentId);
  }

  /**
   * Cancel an upcoming playdate (Host only)
   */
  async cancelPlaydate(userId, id, reason = '') {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (!this._isHost(playdate, parentId)) {
      throw new AppError('Only the host can cancel the playdate', 403, 'FORBIDDEN_CANCEL_PLAYDATE');
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

    await rescheduleRepository.cancelPendingByPlaydateId(id);

    return PlaydateResponseDTO.toResponse(updated, parentId);
  }

  /**
   * Respond to a playdate invitation (RSVP: accept / decline)
   */
  async respondToPlaydate(userId, id, status) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('Cannot respond to a cancelled playdate', 400, 'CANNOT_RESPOND_CANCELLED');
    }
    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('Cannot respond to a completed playdate', 400, 'CANNOT_RESPOND_COMPLETED');
    }
    if (this._isHost(playdate, parentId)) {
      throw new AppError('Host does not need to RSVP to their own playdate', 400, 'HOST_CANNOT_RSVP');
    }

    const participant = (playdate.participants || []).find((p) => toId(p.parentId) === parentId.toString());
    if (!participant) {
      throw new AppError('You are not invited to this playdate', 403, 'NOT_INVITED');
    }
    if (participant.status !== PARTICIPANT_STATUS.PENDING) {
      throw new AppError('You have already responded to this invitation', 400, 'ALREADY_RESPONDED');
    }

    const isAccepting = status === PARTICIPANT_STATUS.ACCEPTED;

    // Participation quota (Free plan: 3/month): check now, consume once the answer is saved
    if (isAccepting) {
      await subscriptionService.checkAndConsumeQuota(parentId, 'playdateParticipate', false);
    }

    // Atomic: a double click cannot answer twice
    const answered = await playdateRepository.updatePendingParticipantStatus(id, parentId, status);
    if (!answered) {
      throw new AppError('You have already responded to this invitation', 400, 'ALREADY_RESPONDED');
    }

    if (isAccepting) {
      try {
        await subscriptionService.checkAndConsumeQuota(parentId, 'playdateParticipate', true);
      } catch (error) {
        await playdateRepository.resetParticipantToPending(id, parentId);
        throw error;
      }

      // Section 6.2: every accepted participant must agree to a pending reschedule
      await rescheduleRepository.addVoterToPending(id, parentId);
    }

    await this._notifyMembersChanged(id);

    const populated = await playdateRepository.findById(id);
    return PlaydateResponseDTO.toResponse(populated, parentId);
  }

  // ---------------------------------------------------------------------------
  // Reschedule (PROJECT_OVERVIEW 6.2)
  // ---------------------------------------------------------------------------

  /**
   * Apply an accepted schedule to the playdate
   * @private
   */
  async _applySchedule(playdateId, { newDate, newStartTime, newLocation }) {
    const updateFields = { scheduledDate: newDate, time: newStartTime };
    if (newLocation?.name && newLocation?.address) {
      updateFields.location = newLocation;
    }
    return playdateRepository.updateById(playdateId, updateFields);
  }

  /**
   * Propose a reschedule for an upcoming playdate (Host only, Section 6.2).
   * Every accepted participant must agree; with no accepted participant the change applies at once.
   */
  async createRescheduleRequest(userId, id, { newDate, newStartTime, newLocation, reason = '' }) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Can only reschedule upcoming playdates', 400, 'INVALID_PLAYDATE_STATUS_FOR_RESCHEDULE');
    }
    if (!this._isHost(playdate, parentId)) {
      throw new AppError('Only the host can propose a reschedule', 403, 'FORBIDDEN_RESCHEDULE');
    }

    const hasNewLocation = Boolean(newLocation?.name || newLocation?.address);
    if (hasNewLocation && !(newLocation.name && newLocation.address)) {
      throw new AppError('A new location needs both a name and an address', 400, 'INVALID_RESCHEDULE_LOCATION');
    }

    const newStart = getScheduledStart(newDate, newStartTime);
    if (newStart <= new Date()) {
      throw new AppError('The new schedule must be in the future', 400, 'RESCHEDULE_IN_PAST');
    }

    const isSameTime = newStart.getTime() === getScheduledStart(playdate.scheduledDate, playdate.time).getTime();
    const isSameLocation =
      !hasNewLocation ||
      (newLocation.name === playdate.location?.name && newLocation.address === playdate.location?.address);
    if (isSameTime && isSameLocation) {
      throw new AppError('The proposed schedule is the same as the current one', 400, 'RESCHEDULE_NO_CHANGE');
    }

    // Each reschedule is its own request: a new proposal replaces the pending one
    await rescheduleRepository.cancelPendingByPlaydateId(id);

    const voters = (playdate.participants || [])
      .filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED)
      .map((p) => ({ parentId: toId(p.parentId), status: PARTICIPANT_STATUS.PENDING, respondedAt: null }));

    const schedule = {
      newDate: new Date(newDate),
      newStartTime,
      newLocation: hasNewLocation ? newLocation : playdate.location,
    };

    // No accepted participant to ask: apply right away (before recording the request)
    const isAutoApplied = voters.length === 0;
    if (isAutoApplied) {
      await this._applySchedule(id, schedule);
    }

    const rescheduleReq = await rescheduleRepository.create({
      playdateId: id,
      requestedBy: parentId,
      ...schedule,
      reason: reason || '',
      status: isAutoApplied ? RESCHEDULE_STATUS.ACCEPTED : RESCHEDULE_STATUS.PENDING,
      responses: voters,
      resolvedAt: isAutoApplied ? new Date() : null,
    });

    const populatedReq = await rescheduleRepository.findById(rescheduleReq._id);
    const updatedPlaydate = await playdateRepository.findById(id);

    return {
      rescheduleRequest: RescheduleResponseDTO.toResponse(populatedReq, parentId),
      isAutoApplied,
      playdate: PlaydateResponseDTO.toResponse(updatedPlaydate, parentId),
    };
  }

  /**
   * Vote on a pending reschedule request (Section 6.2):
   * one decline -> Declined (old schedule kept); all accepted -> Accepted (playdate updated)
   */
  async voteRescheduleRequest(userId, id, { requestId, status }) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Can only vote on upcoming playdates', 400, 'INVALID_PLAYDATE_STATUS');
    }

    const query = { playdateId: id, status: RESCHEDULE_STATUS.PENDING };
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
        responses: { $elemMatch: { parentId, status: PARTICIPANT_STATUS.PENDING } },
      },
      { $set: { 'responses.$.status': status, 'responses.$.respondedAt': new Date() } },
      { new: true }
    );

    if (!updatedReq) {
      const isVoter = existingReq.responses?.some((r) => toId(r.parentId) === parentId.toString());
      if (!isVoter) {
        throw new AppError('You do not have permission to vote on this reschedule request', 403, 'NOT_AUTHORIZED_TO_VOTE');
      }
      throw new AppError('You have already voted or this request is already resolved', 400, 'ALREADY_VOTED');
    }

    if (status === PARTICIPANT_STATUS.DECLINED) {
      updatedReq.status = RESCHEDULE_STATUS.DECLINED;
      updatedReq.resolvedAt = new Date();
      await updatedReq.save();
    } else if (updatedReq.responses.every((r) => r.status === PARTICIPANT_STATUS.ACCEPTED)) {
      // Update the playdate first so an accepted request always matches the playdate schedule
      await this._applySchedule(id, updatedReq);
      updatedReq.status = RESCHEDULE_STATUS.ACCEPTED;
      updatedReq.resolvedAt = new Date();
      await updatedReq.save();
    }

    const populatedReq = await rescheduleRepository.findById(updatedReq._id);
    const updatedPlaydate = await playdateRepository.findById(id);

    return {
      rescheduleRequest: RescheduleResponseDTO.toResponse(populatedReq, parentId),
      playdate: PlaydateResponseDTO.toResponse(updatedPlaydate, parentId),
    };
  }

  /**
   * Get the latest reschedule request of a playdate (with the caller's own vote)
   */
  async getRescheduleRequest(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (!this._isHost(playdate, parentId) && !this._isInvited(playdate, parentId)) {
      throw new AppError('You do not have permission to view this playdate information', 403, 'FORBIDDEN_VIEW_PLAYDATE');
    }

    const rescheduleReq = await rescheduleRepository.findLatestByPlaydateId(id);
    return RescheduleResponseDTO.toResponse(rescheduleReq, parentId);
  }
}

export const playdateService = new PlaydateService();
export default playdateService;
