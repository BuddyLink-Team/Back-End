import playdateRepository from './playdate.repository.js';
import rescheduleRepository from './reschedule.repository.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import connectionService from '../connection/connection.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import safetyService from '../safety/safety.service.js';
import AppError from '../../shared/exceptions/app-error.js';
import logger from '../../shared/logger/index.js';
import {
  getScheduledStart,
  getScheduledEnd,
  getStartOfZonedDay,
  getZonedParts,
  intervalsOverlap,
} from '../../shared/helpers/date.helper.js';
import { PlaydateResponseDTO, RescheduleResponseDTO } from './playdate.dto.js';
import {
  PLAYDATE_STATUS,
  PARTICIPANT_STATUS,
  RESCHEDULE_STATUS,
  INVITABLE_FRIENDS_LIMIT,
  PLAYDATE_RULES,
  PLAYDATE_WARNING_CODES,
  PLAYDATE_REMINDER,
  REMINDER_KINDS,
} from './playdate.constants.js';
import { calculateChildPairScore } from '../discovery/matching.rules.js';
import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import { PAGINATION } from '../../shared/constants/index.js';
import { emitPlaydateEvent, PLAYDATE_EVENTS } from './playdate.events.js';

const toId = (ref) => (ref?._id || ref)?.toString();
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// scheduledDate is the calendar day; the start can be up to a day later and lasts up to 8h
const CONFLICT_WINDOW_MS = 2 * DAY_MS;

const durationOf = (playdate) => playdate?.durationMinutes ?? PLAYDATE_RULES.DEFAULT_DURATION_MINUTES;
const endOf = (start, durationMinutes) => new Date(start.getTime() + durationMinutes * MINUTE_MS);
// A family has one participant entry per invited child
const uniqueParentIds = (participants = []) => [...new Set(participants.map((p) => toId(p.parentId)))];

/**
 * Reminder state for a (new) start time: a playdate less than 24h away never gets the 24h reminder
 * @param {Date} start
 * @param {Date} [now]
 */
const initialReminders = (start, now = new Date()) => ({
  h24SentAt: start.getTime() - now.getTime() < DAY_MS ? now : null,
  h1SentAt: null,
});

// Friend shown in the invite list: only the area, never a family's exact address or coordinates
const toFriendCard = (friendParent) => ({
  id: friendParent._id.toString(),
  fullName: friendParent.fullName,
  avatarUrl: friendParent.avatarUrl || '',
  isVerified: Boolean(friendParent.verification?.isVerifiedParent),
  location: {
    area: friendParent.location?.area || '',
    city: friendParent.location?.city || '',
  },
});

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
    const accepted = (playdate.participants || []).filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED);
    const parentIds = [toId(playdate.hostParentId), ...uniqueParentIds(accepted)];
    // Host child <-> each accepted child played together (connection records them as child pairs)
    const childPairs = accepted.map((p) => ({
      parentIds: [toId(playdate.hostParentId), toId(p.parentId)],
      childIds: [toId(playdate.hostChildId), toId(p.childId)],
    }));
    await emitPlaydateEvent(PLAYDATE_EVENTS.COMPLETED, { playdateId: toId(playdate._id), parentIds, childPairs });
  }

  /**
   * When some children are busy: their upcoming playdates (as host child or accepted participant)
   * around a time window, one entry per child and playdate
   * @param {Array<string|ObjectId>} childIds
   * @param {Date} from
   * @param {Date} to
   * @param {string|ObjectId} [excludePlaydateId] - The playdate being rescheduled / answered
   * @returns {Promise<Array<{ childId: string, playdateId: string, start: Date, end: Date }>>}
   */
  async getBusyIntervals(childIds, from, to, excludePlaydateId = null) {
    const ids = [...new Set(childIds.filter(Boolean).map(String))];
    if (!ids.length) return [];

    const playdates = await playdateRepository.findUpcomingForChildren(ids, {
      from: new Date(from.getTime() - CONFLICT_WINDOW_MS),
      to: new Date(to.getTime() + CONFLICT_WINDOW_MS),
      excludePlaydateId,
    });

    return playdates.flatMap((playdate) => {
      const start = getScheduledStart(playdate.scheduledDate, playdate.time);
      const end = endOf(start, durationOf(playdate));
      const involved = new Set([
        toId(playdate.hostChildId),
        ...(playdate.participants || [])
          .filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED)
          .map((p) => toId(p.childId)),
      ]);
      return ids.filter((id) => involved.has(id)).map((childId) => ({ childId, playdateId: toId(playdate._id), start, end }));
    });
  }

  /**
   * Upcoming playdates overlapping [start, end) for some children (host child or accepted participant)
   * @param {Array<string|ObjectId>} childIds
   * @param {Date} start
   * @param {Date} end
   * @param {string|ObjectId} [excludePlaydateId] - The playdate being rescheduled / answered
   * @returns {Promise<Array<{ childId: string, playdateId: string }>>}
   * @private
   */
  async _findConflicts(childIds, start, end, excludePlaydateId = null) {
    const busy = await this.getBusyIntervals(childIds, start, end, excludePlaydateId);
    return busy
      .filter((interval) => intervalsOverlap(start, end, interval.start, interval.end))
      .map(({ childId, playdateId }) => ({ childId, playdateId }));
  }

  /**
   * Fail with 409 when one of the caller's own children already has an overlapping playdate.
   * The caller is a member of that playdate (their child is in it), so its id may be shared.
   * @param {string|ObjectId|Array<string|ObjectId>} childIds
   * @private
   */
  async _assertNoConflict(childIds, start, end, excludePlaydateId = null) {
    const conflicts = await this._findConflicts([].concat(childIds), start, end, excludePlaydateId);
    if (conflicts.length > 0) {
      throw new AppError(
        'Your child already has a playdate at this time',
        409,
        PLAYDATE_WARNING_CODES.SCHEDULE_CONFLICT,
        conflicts.map(({ playdateId }) => ({ playdateId }))
      );
    }
  }

  /**
   * Invited children of the host (a family can have several): connected friends only, their own child,
   * no block relationship
   * @param {ObjectId} hostParentId
   * @param {Array<{ parentId: string, childId: string }>} [rawParticipants]
   * @returns {Promise<Array<{ parentId: string, childId: string }>>}
   * @private
   */
  async _validateInvitees(hostParentId, rawParticipants) {
    const participants = Array.isArray(rawParticipants) ? rawParticipants : [];
    if (participants.some((p) => toId(p.parentId) === hostParentId.toString())) {
      throw new AppError('Host cannot invite themselves to a playdate', 400, 'CANNOT_INVITE_SELF');
    }

    const seenChildren = new Set();
    const uniqueParticipants = participants.filter((p) => {
      const childId = toId(p.childId);
      if (seenChildren.has(childId)) return false;
      seenChildren.add(childId);
      return true;
    });

    // Safety first: no invitation between parents who blocked each other
    if (await safetyService.isBlockedWithAny(hostParentId, uniqueParentIds(uniqueParticipants))) {
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
      if (await childService.isChildLocked(toId(p.childId), targetParentId)) {
        throw new AppError('Invited child profile is not available', 400, 'INVALID_PARTICIPANT_CHILD');
      }
    }
    return uniqueParticipants;
  }

  /**
   * Schedule conflicts of invited children, returned as warnings (they are checked again when their parent accepts)
   * @private
   */
  async _inviteeWarnings(invitees, start, end, excludePlaydateId = null) {
    const conflicts = await this._findConflicts(invitees.map((p) => toId(p.childId)), start, end, excludePlaydateId);
    return [...new Set(conflicts.map((c) => c.childId))].map((childId) => ({
      code: PLAYDATE_WARNING_CODES.SCHEDULE_CONFLICT,
      childId,
    }));
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
   * Playdate for one parent, with canLeave: a family who joined and blocked the host or another joined
   * family gets a way out. Who was blocked stays private, and only the blocker's own blocks count.
   * @param {Object} playdate
   * @param {ObjectId} parentId
   * @returns {Promise<Object>}
   * @private
   */
  async _toViewerResponse(playdate, parentId) {
    const response = PlaydateResponseDTO.toResponse(playdate, parentId);
    const hasJoined =
      playdate.status === PLAYDATE_STATUS.UPCOMING && response.myParticipantStatus === PARTICIPANT_STATUS.ACCEPTED;
    if (!hasJoined) return { ...response, canLeave: false };

    const otherMemberIds = this.getAcceptedParentIds(playdate).filter((id) => id !== parentId.toString());
    return { ...response, canLeave: await safetyService.hasBlockedAny(parentId, otherMemberIds) };
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

    return this._toViewerResponse(playdate, parentId);
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
   * Send the reminders that are due (run every 15 minutes by the reminder job):
   * - 1h reminder when the playdate starts within the next hour (+ one job interval);
   * - 24h reminder when it starts within the next 24h, but not within that hour.
   * Each reminder is claimed atomically before it is sent, so it goes out exactly once.
   * The host and every accepted participant are notified (notification module listener).
   * @param {Date} [now]
   * @returns {Promise<{ h24: number, h1: number }>}
   */
  async sendDueReminders(now = new Date()) {
    const slackMs = PLAYDATE_REMINDER.JOB_INTERVAL_MINUTES * MINUTE_MS;
    const h1Window = 60 * MINUTE_MS + slackMs;
    const h24Window = DAY_MS + slackMs;
    const candidates = await playdateRepository.findUpcomingScheduledBetween(
      new Date(now.getTime() - CONFLICT_WINDOW_MS),
      new Date(now.getTime() + CONFLICT_WINDOW_MS)
    );
    const result = { [REMINDER_KINDS.H24]: 0, [REMINDER_KINDS.H1]: 0 };

    for (const playdate of candidates) {
      const start = getScheduledStart(playdate.scheduledDate, playdate.time);
      const timeLeft = start.getTime() - now.getTime();
      if (timeLeft <= 0) continue;

      let kind = null;
      if (timeLeft <= h1Window && !playdate.reminders?.h1SentAt) kind = REMINDER_KINDS.H1;
      else if (timeLeft > h1Window && timeLeft <= h24Window && !playdate.reminders?.h24SentAt) kind = REMINDER_KINDS.H24;
      if (!kind) continue;

      const claimed = await playdateRepository.claimReminder(playdate._id, kind, now);
      if (!claimed) continue; // another run sent it
      // Too late for the 24h reminder: never send it after the 1h one
      if (kind === REMINDER_KINDS.H1) await playdateRepository.skipH24Reminder(playdate._id, now);

      const day = getZonedParts(start);
      await emitPlaydateEvent(PLAYDATE_EVENTS.REMINDER_DUE, {
        playdateId: toId(playdate._id),
        kind,
        activity: playdate.activity,
        time: playdate.time,
        date: `${String(day.day).padStart(2, '0')}/${String(day.month).padStart(2, '0')}`,
        placeName: playdate.location?.name || '',
        recipientParentIds: this.getAcceptedParentIds(playdate),
      });
      result[kind] += 1;
    }

    return result;
  }

  /**
   * Connected friends (and their children) that can be invited to a playdate, sorted by name.
   * With a childId: the friends' children ranked for that child instead (see _getPlaymatesForChild).
   * @param {string} userId
   * @param {{ search?: string, limit?: number|string, childId?: string }} [options]
   *   - search: friend name; limit: max friends (default 50); childId: own child the playdate is for
   */
  async getInvitableFriends(userId, { search, limit, childId } = {}) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }
    const parentId = parent._id;

    let ownChild = null;
    if (childId) {
      await childService.assertChildUsable(childId, parentId);
      ownChild = (await childService.getActiveChildrenByParentId(parentId)).find((c) => c._id.toString() === childId);
      if (!ownChild) {
        throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
      }
    }

    const [connections, blockedIds] = await Promise.all([
      connectionService.getAcceptedConnections(parentId),
      safetyService.getBlockedParentIds(parentId),
    ]);
    // Parents in a block relationship (either direction) cannot be invited
    const blockedSet = new Set(blockedIds.map(String));
    const searchText = search?.trim().toLowerCase();
    const maxFriends = Math.min(PAGINATION.MAX_LIMIT, Math.max(1, parseInt(limit, 10) || INVITABLE_FRIENDS_LIMIT));

    const friendParents = connections
      .map((conn) => conn.parents.find((p) => toId(p) !== parentId.toString()))
      .filter((friend) => friend && !blockedSet.has(toId(friend)))
      .filter((friend) => !searchText || friend.fullName?.toLowerCase().includes(searchText))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'vi'))
      .slice(0, maxFriends);

    // Children of every friend in one query (those locked by their parent's Free plan cannot be invited)
    const childrenByParent = await childService.getUsableChildrenByParentIds(friendParents.map((f) => f._id));

    if (ownChild) {
      return this._getPlaymatesForChild(parent, ownChild, friendParents, childrenByParent, connections);
    }

    return friendParents.map((friendParent) => ({
      ...toFriendCard(friendParent),
      children: (childrenByParent.get(friendParent._id.toString()) || []).map((c) => ({
        id: c._id.toString(),
        displayName: c.displayName,
        dateOfBirth: c.dateOfBirth,
        gender: c.gender,
        interests: c.interests || [],
      })),
    }));
  }

  /**
   * Friends' children ranked for one own child: children already paired with it first ("matched"),
   * then every other child ("others"), each sorted by match score. Age gaps only warn.
   * @private
   */
  _getPlaymatesForChild(parent, ownChild, friendParents, childrenByParent, connections) {
    // Pairs of this child on any accepted connection: partner child id -> pair
    const ownChildId = ownChild._id.toString();
    const pairsByPartner = new Map();
    connections.forEach((connection) => {
      (connection.childPairs || []).forEach((pair) => {
        const ids = pair.childIds.map(String);
        if (!ids.includes(ownChildId)) return;
        pairsByPartner.set(ids.find((id) => id !== ownChildId), pair);
      });
    });

    const ownAge = calculateAgeYears(ownChild.dateOfBirth);
    const matched = [];
    const others = [];

    friendParents.forEach((friendParent) => {
      (childrenByParent.get(friendParent._id.toString()) || []).forEach((child) => {
        const childId = child._id.toString();
        const age = calculateAgeYears(child.dateOfBirth);
        const pair = pairsByPartner.get(childId);
        const warnings = [];
        if (ownAge !== null && age !== null && Math.abs(ownAge - age) > PLAYDATE_RULES.MAX_AGE_GAP_YEARS) {
          warnings.push({ code: PLAYDATE_WARNING_CODES.AGE_GAP, ageGapYears: Math.abs(ownAge - age) });
        }

        const entry = {
          parent: toFriendCard(friendParent),
          // Age only: never the date of birth
          child: {
            id: childId,
            displayName: child.displayName,
            age,
            gender: child.gender,
            interests: child.interests || [],
          },
          matchScore: calculateChildPairScore(ownChild, parent, child, friendParent),
          source: pair?.source || null,
          warnings,
        };
        (pair ? matched : others).push(entry);
      });
    });

    const byScore = (a, b) => b.matchScore - a.matchScore;
    return { matched: matched.sort(byScore), others: others.sort(byScore) };
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
    await childService.assertChildUsable(data.hostChildId, hostParentId);

    // 2. The playdate must start in the future
    const durationMinutes = data.durationMinutes ?? PLAYDATE_RULES.DEFAULT_DURATION_MINUTES;
    const start = getScheduledStart(data.scheduledDate, data.time);
    const end = getScheduledEnd(data.scheduledDate, data.time, durationMinutes);
    if (start <= new Date()) {
      throw new AppError('The playdate must start in the future', 400, 'PLAYDATE_IN_PAST');
    }

    // 3. Filter, deduplicate, and validate participants
    const uniqueParticipants = await this._validateInvitees(hostParentId, data.participants);

    // 4. The host's child cannot be in two playdates at once; invited children only get a warning
    //    (they are checked again when their parent accepts). Nothing is created or sent before this.
    await this._assertNoConflict(data.hostChildId, start, end);
    const warnings = await this._inviteeWarnings(uniqueParticipants, start, end);

    // 5. Check the creation quota first, consume it only once the playdate exists
    await subscriptionService.checkAndConsumeQuota(hostParentId, 'playdateCreate', false);

    const { hostChildId, scheduledDate, time, activity, location, note } = data;
    const playdate = await playdateRepository.create({
      hostParentId,
      hostChildId,
      scheduledDate,
      time,
      durationMinutes,
      reminders: initialReminders(start),
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

    // 6. Group chat starts with the host; invitees join once they accept
    await this._notifyMembersChanged(playdate._id);

    if (uniqueParticipants.length > 0) {
      await emitPlaydateEvent(PLAYDATE_EVENTS.INVITED, {
        playdateId: playdate._id.toString(),
        hostParentId: hostParentId.toString(),
        participantParentIds: uniqueParentIds(uniqueParticipants),
      });
    }

    const hostProfile = await parentService.getParentById(hostParentId);
    void emitPlaydateEvent(PLAYDATE_EVENTS.CREATED, {
      playdateId: playdate._id.toString(),
      activity: playdate.activity,
      hostParentId: hostParentId.toString(),
      hostName: hostProfile?.fullName || 'Một phụ huynh',
    });

    const populated = await playdateRepository.findById(playdate._id);
    return { ...PlaydateResponseDTO.toResponse(populated, hostParentId), warnings };
  }

  /**
   * Invite more friends' children to an upcoming playdate (Host only), e.g. once every invitee declined.
   * Same checks as at creation. A family still invited or joined cannot be invited again, one who declined or left can,
   * and no quota is used: the playdate was counted when it was created.
   * @param {string} userId
   * @param {string} id
   * @param {Array<{ parentId: string, childId: string }>} participants
   * @returns {Promise<Object>} The playdate, with SCHEDULE_CONFLICT warnings for busy invitees
   */
  async inviteParticipants(userId, id, participants) {
    const hostParentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (!this._isHost(playdate, hostParentId)) {
      throw new AppError('Only the host can invite friends to the playdate', 403, 'FORBIDDEN_INVITE');
    }
    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Friends can only be invited to an upcoming playdate', 400, 'INVALID_PLAYDATE_STATUS');
    }
    const start = getScheduledStart(playdate.scheduledDate, playdate.time);
    if (start <= new Date()) {
      throw new AppError('The playdate has already started', 400, 'PLAYDATE_IN_PAST');
    }

    const invitees = await this._validateInvitees(hostParentId, participants);
    if (!invitees.length) {
      throw new AppError('Pick at least one friend to invite', 400, 'NO_INVITEES');
    }
    // A family who declined or left can be invited again; one still pending or joined cannot
    const entryByParent = new Map((playdate.participants || []).map((p) => [toId(p.parentId), p]));
    const isStillIn = (p) => {
      const entry = entryByParent.get(toId(p.parentId));
      return Boolean(entry) && entry.status !== PARTICIPANT_STATUS.DECLINED;
    };
    if (invitees.some(isStillIn)) {
      throw new AppError('This family is already invited to the playdate', 400, 'ALREADY_INVITED');
    }
    const reinvitedParentIds = uniqueParentIds(invitees).filter((pid) => entryByParent.has(pid));

    const warnings = await this._inviteeWarnings(invitees, start, endOf(start, durationOf(playdate)), id);

    // Atomic: fails if the playdate was closed or the same family invited in the meantime
    const updated = await playdateRepository.addParticipants(
      id,
      invitees.map((p) => ({
        parentId: toId(p.parentId),
        childId: toId(p.childId),
        status: PARTICIPANT_STATUS.PENDING,
        invitedAt: new Date(),
        // A family invited again keeps the participation it already used for this playdate
        quotaConsumedAt: entryByParent.get(toId(p.parentId))?.quotaConsumedAt ?? null,
      })),
      reinvitedParentIds
    );
    if (!updated) {
      throw new AppError('The playdate changed in the meantime, please reload it', 409, 'PLAYDATE_CHANGED');
    }

    await emitPlaydateEvent(PLAYDATE_EVENTS.INVITED, {
      playdateId: id.toString(),
      hostParentId: hostParentId.toString(),
      participantParentIds: uniqueParentIds(invitees),
    });

    const populated = await playdateRepository.findById(id);
    return { ...PlaydateResponseDTO.toResponse(populated, hostParentId), warnings };
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

    const before = await playdateRepository.cancelIfOpen(id, {
      cancelledBy: parentId,
      reason: reason || 'Cancelled by host',
      cancelledAt: new Date(),
    });
    if (!before) {
      throw new AppError('The playdate changed in the meantime, please reload it', 409, 'PLAYDATE_CHANGED');
    }

    await rescheduleRepository.cancelPendingByPlaydateId(id);
    await this._refundJoinedParticipants(before);

    void emitPlaydateEvent(PLAYDATE_EVENTS.CANCELLED, {
      playdateId: id.toString(),
      activity: before.activity,
      cancelledByAdmin: false,
      reason,
    });

    const updated = await playdateRepository.findById(id);
    return PlaydateResponseDTO.toResponse(updated, parentId);
  }

  /**
   * The host cancelled: families who were still in give back the participation used this month.
   * Families who left keep it used (their own choice), and the host's creation is not given back.
   * @param {Object} playdate - The playdate as it was before the cancellation
   * @private
   */
  async _refundJoinedParticipants(playdate) {
    const acceptedEntries = (playdate.participants || []).filter(
      (p) => p.status === PARTICIPANT_STATUS.ACCEPTED && p.quotaConsumedAt
    );
    // One participation per family, whatever the number of its children
    const joined = [...new Map(acceptedEntries.map((p) => [toId(p.parentId), p])).values()];
    await Promise.all(
      joined.map((p) =>
        subscriptionService.refundQuota(p.parentId, 'playdateParticipate', p.quotaConsumedAt).catch((error) => {
          logger.error(`[Playdate] participation refund failed for parent=${p.parentId}: ${error.message}`);
        })
      )
    );
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

    // The parent answers once for all the children of the family who were invited
    const familyEntries = (playdate.participants || []).filter((p) => toId(p.parentId) === parentId.toString());
    const [participant] = familyEntries;
    if (!participant) {
      throw new AppError('You are not invited to this playdate', 403, 'NOT_INVITED');
    }
    if (participant.status !== PARTICIPANT_STATUS.PENDING) {
      throw new AppError('You have already responded to this invitation', 400, 'ALREADY_RESPONDED');
    }

    const isAccepting = status === PARTICIPANT_STATUS.ACCEPTED;
    // A family who left and was invited again already used a participation for this playdate
    const usesQuota = isAccepting && !participant.quotaConsumedAt;

    if (isAccepting) {
      const childIds = familyEntries.map((p) => toId(p.childId));
      // A child locked by the Free plan (invited while the parent was Premium) cannot join
      await Promise.all(childIds.map((childId) => childService.assertChildUsable(childId, parentId)));

      // An invited child cannot join two playdates at once (declining is always allowed)
      const start = getScheduledStart(playdate.scheduledDate, playdate.time);
      await this._assertNoConflict(childIds, start, endOf(start, durationOf(playdate)), id);

      // Participation quota (Free plan: 3/month): check now, consume once the answer is saved
      if (usesQuota) {
        await subscriptionService.checkAndConsumeQuota(parentId, 'playdateParticipate', false);
      }
    }

    // Atomic: a double click cannot answer twice
    const answered = await playdateRepository.updatePendingParticipantStatus(id, parentId, status);
    if (!answered) {
      throw new AppError('You have already responded to this invitation', 400, 'ALREADY_RESPONDED');
    }

    if (isAccepting) {
      if (usesQuota) {
        try {
          await subscriptionService.checkAndConsumeQuota(parentId, 'playdateParticipate', true);
        } catch (error) {
          await playdateRepository.resetParticipantToPending(id, parentId);
          throw error;
        }
        await playdateRepository.markParticipantQuotaConsumed(id, parentId);
      }

      // Section 6.2: every accepted participant must agree to a pending reschedule
      await rescheduleRepository.addVoterToPending(id, parentId);
    }

    await this._notifyMembersChanged(id);

    const populated = await playdateRepository.findById(id);
    return this._toViewerResponse(populated, parentId);
  }

  /**
   * Leave an upcoming playdate (Participant only)
   * @param {string} userId
   * @param {string} id - Playdate ID
   */
  async leavePlaydate(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Cannot leave a completed or cancelled playdate', 400, 'INVALID_PLAYDATE_STATUS');
    }

    if (this._isHost(playdate, parentId)) {
      throw new AppError('Host cannot leave their own playdate. Cancel the playdate instead.', 400, 'HOST_CANNOT_LEAVE');
    }

    const participant = (playdate.participants || []).find((p) => toId(p.parentId) === parentId.toString());
    if (!participant) {
      throw new AppError('You are not a participant of this playdate', 403, 'NOT_PARTICIPANT');
    }
    if (participant.status === PARTICIPANT_STATUS.DECLINED) {
      throw new AppError('You have already left this playdate', 400, 'ALREADY_LEFT');
    }

    const left = await playdateRepository.markParticipantLeft(id, parentId);
    if (!left) {
      throw new AppError('You have already left this playdate or it is no longer upcoming', 409, 'LEAVE_CONFLICT');
    }

    await this._removeVoterFromPendingReschedule(id, parentId);
    await this._notifyMembersChanged(id);

    const populated = await playdateRepository.findById(id);
    return PlaydateResponseDTO.toResponse(populated, parentId);
  }

  /**
   * A parent who left no longer votes on the pending reschedule (Section 6.2: only accepted
   * participants vote). If every remaining voter already accepted, the new schedule applies now.
   * @private
   */
  async _removeVoterFromPendingReschedule(playdateId, parentId) {
    const pendingReq = await rescheduleRepository.removeVoterFromPending(playdateId, parentId);
    if (!pendingReq || !pendingReq.responses.every((r) => r.status === PARTICIPANT_STATUS.ACCEPTED)) return;

    await this._acceptReschedule(pendingReq);
  }

  // ---------------------------------------------------------------------------
  // Reschedule (PROJECT_OVERVIEW 6.2)
  // ---------------------------------------------------------------------------

  /**
   * Apply an accepted schedule to the playdate
   * @private
   */
  async _applySchedule(playdateId, { newDate, newStartTime, newDurationMinutes, newLocation }) {
    const updateFields = {
      scheduledDate: newDate,
      time: newStartTime,
      // New start: reminders are sent again for it
      reminders: initialReminders(getScheduledStart(newDate, newStartTime)),
    };
    if (newDurationMinutes) {
      updateFields.durationMinutes = newDurationMinutes;
    }
    if (newLocation?.name && newLocation?.address) {
      updateFields.location = newLocation;
    }
    return playdateRepository.updateById(playdateId, updateFields);
  }

  /**
   * Accept a request and apply its schedule. The request is claimed first, so a request the host
   * has just withdrawn never changes the playdate.
   * @private
   * @returns {Promise<boolean>} false when the request was no longer pending
   */
  async _acceptReschedule(request) {
    const accepted = await rescheduleRepository.resolvePending({ _id: request._id }, RESCHEDULE_STATUS.ACCEPTED);
    if (!accepted) return false;

    try {
      await this._applySchedule(accepted.playdateId, accepted);
    } catch (error) {
      // An accepted request must always match the playdate schedule
      await rescheduleRepository.findOneAndUpdate(
        { _id: accepted._id, status: RESCHEDULE_STATUS.ACCEPTED },
        { $set: { status: RESCHEDULE_STATUS.PENDING, resolvedAt: null } },
      );
      throw error;
    }
    return true;
  }

  /**
   * Propose a reschedule for an upcoming playdate (Host only, Section 6.2).
   * Every accepted participant must agree; with no accepted participant the change applies at once.
   */
  async createRescheduleRequest(userId, id, { newDate, newStartTime, newDurationMinutes, newLocation, reason = '' }) {
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

    const duration = newDurationMinutes ?? durationOf(playdate);
    const isSameTime =
      newStart.getTime() === getScheduledStart(playdate.scheduledDate, playdate.time).getTime() &&
      duration === durationOf(playdate);
    const isSameLocation =
      !hasNewLocation ||
      (newLocation.name === playdate.location?.name && newLocation.address === playdate.location?.address);
    if (isSameTime && isSameLocation) {
      throw new AppError('The proposed schedule is the same as the current one', 400, 'RESCHEDULE_NO_CHANGE');
    }

    // The host's child must be free at the new time (this playdate itself does not count)
    await this._assertNoConflict(toId(playdate.hostChildId), newStart, endOf(newStart, duration), id);

    // Each reschedule is its own request: a new proposal replaces the pending one
    await rescheduleRepository.cancelPendingByPlaydateId(id);

    // One vote per family
    const voters = uniqueParentIds((playdate.participants || []).filter((p) => p.status === PARTICIPANT_STATUS.ACCEPTED))
      .map((voterId) => ({ parentId: voterId, status: PARTICIPANT_STATUS.PENDING, respondedAt: null }));

    const schedule = {
      newDate: new Date(newDate),
      newStartTime,
      newDurationMinutes: duration,
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

    // Accepting: the voter's children must be free at the new time (declining is always allowed)
    const voterChildIds = (playdate.participants || [])
      .filter((p) => toId(p.parentId) === parentId.toString())
      .map((p) => toId(p.childId));
    if (status === PARTICIPANT_STATUS.ACCEPTED && voterChildIds.length) {
      const newStart = getScheduledStart(existingReq.newDate, existingReq.newStartTime);
      const newDuration = existingReq.newDurationMinutes ?? durationOf(playdate);
      await this._assertNoConflict(voterChildIds, newStart, endOf(newStart, newDuration), id);
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

    // The request may have been withdrawn or decided since the vote was recorded
    let isStillValid = true;
    if (status === PARTICIPANT_STATUS.DECLINED) {
      isStillValid = Boolean(await rescheduleRepository.resolvePending({ _id: updatedReq._id }, RESCHEDULE_STATUS.DECLINED));
    } else if (updatedReq.responses.every((r) => r.status === PARTICIPANT_STATUS.ACCEPTED)) {
      isStillValid = await this._acceptReschedule(updatedReq);
    }
    if (!isStillValid) {
      throw new AppError('No pending reschedule request found to vote on', 404, 'RESCHEDULE_NOT_FOUND');
    }

    const populatedReq = await rescheduleRepository.findById(updatedReq._id);
    const updatedPlaydate = await playdateRepository.findById(id);

    return {
      rescheduleRequest: RescheduleResponseDTO.toResponse(populatedReq, parentId),
      playdate: await this._toViewerResponse(updatedPlaydate, parentId),
    };
  }

  /**
   * Withdraw a pending reschedule request (Host only): the votes are dropped and the schedule stays.
   */
  async cancelRescheduleRequest(userId, id, { requestId } = {}) {
    const parentId = await this._getParentId(userId);
    const playdate = await this._findPlaydateOrFail(id);

    if (playdate.status !== PLAYDATE_STATUS.UPCOMING) {
      throw new AppError('Can only withdraw a reschedule of upcoming playdates', 400, 'INVALID_PLAYDATE_STATUS_FOR_RESCHEDULE');
    }
    if (!this._isHost(playdate, parentId)) {
      throw new AppError('Only the host can withdraw a reschedule', 403, 'FORBIDDEN_CANCEL_RESCHEDULE');
    }

    const query = { playdateId: id };
    if (requestId) {
      query._id = requestId;
    }

    const cancelledReq = await rescheduleRepository.resolvePending(query, RESCHEDULE_STATUS.CANCELLED);
    if (!cancelledReq) {
      throw new AppError('No pending reschedule request found to withdraw', 404, 'RESCHEDULE_NOT_FOUND');
    }

    const populatedReq = await rescheduleRepository.findById(cancelledReq._id);

    return {
      rescheduleRequest: RescheduleResponseDTO.toResponse(populatedReq, parentId),
      playdate: await this._toViewerResponse(playdate, parentId),
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


  /**
   * Admin oversight: playdates across the platform counted by status
   * @returns {Promise<{ total: number, upcoming: number, completed: number, cancelled: number }>}
   */
  async getPlaydateStats() {
    return playdateRepository.countByStatus();
  }

  /**
   * Playdates a parent hosts or is invited to, counted by status
   * @param {string|ObjectId} parentId
   * @returns {Promise<{ all: number, upcoming: number, completed: number, cancelled: number }>}
   */
  async getPlaydateCountsForParent(parentId) {
    const { all, upcoming, completed, cancelled } = await playdateRepository.countByStatusesForParent(parentId);
    return { all, upcoming, completed, cancelled };
  }

  /**
   * Admin oversight: one page of all playdates across the platform
   * @param {{ status?: string, search?: string, fromDate?: string, toDate?: string, page: number, limit: number }} options
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async getPlaydatesForAdmin({ status, search, fromDate, toDate, page, limit }) {
    const hostParentIds = search ? await parentService.findParentIdsByName(search) : [];
    return playdateRepository.findPageForAdmin({ status, search, hostParentIds, fromDate, toDate, page, limit });
  }

  /**
   * Admin oversight: full detail of a single playdate
   */
  async getPlaydateDetailForAdmin(id) {
    const playdate = await playdateRepository.findById(id);
    if (!playdate) {
      throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
    }

    const pendingReschedule = await rescheduleRepository.findOne({
      playdateId: id,
      status: RESCHEDULE_STATUS.PENDING,
    });

    return {
      playdate,
      pendingReschedule,
    };
  }

  /**
   * Admin oversight: force-cancel an upcoming playdate
   */
  async cancelPlaydateByAdmin(id, reason = '') {
    const playdate = await this._findPlaydateOrFail(id);

    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('This playdate is already cancelled', 400, 'ALREADY_CANCELLED');
    }
    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('Cannot cancel a completed playdate', 400, 'INVALID_PLAYDATE_STATUS');
    }

    const before = await playdateRepository.cancelIfOpen(id, {
      cancelledBy: null,
      cancelledByAdmin: true,
      reason: reason || 'Cancelled by admin',
      cancelledAt: new Date(),
    });
    if (!before) {
      throw new AppError('The playdate changed in the meantime, please reload it', 409, 'PLAYDATE_CHANGED');
    }

    await rescheduleRepository.cancelPendingByPlaydateId(id);
    // Same as a host cancellation: families still in get their participation back
    await this._refundJoinedParticipants(before);

    void emitPlaydateEvent(PLAYDATE_EVENTS.CANCELLED, {
      playdateId: id.toString(),
      activity: before.activity,
      cancelledByAdmin: true,
      reason,
    });

    return playdateRepository.findById(id);
  }

  /**
   * Playdates created between two instants
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Promise<number>}
   */
  async countCreatedBetween(fromDate, toDate) {
    return playdateRepository.countCreatedBetween(fromDate, toDate);
  }

  /**
   * Count distinct parents who hosted a playdate or accepted an invitation, on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countDistinctParentsWithPlaydateBeforeDate(date) {
    return playdateRepository.countDistinctParentsWithPlaydateBeforeDate(date);
  }

  /**
   * Get playdate analytics including status breakdown and timeline
   * @param {{ fromDate: Date, toDate: Date, dateFormat: string, timeZone: string }} params
   * @returns {Promise<{ byStatus: Object, timeline: Array<{ period: string, count: number }> }>}
   */
  async getPlaydateAnalytics({ fromDate, toDate, dateFormat, timeZone }) {
    const [byStatus, timeline] = await Promise.all([
      playdateRepository.countByStatusInPeriod(fromDate, toDate),
      playdateRepository.aggregatePlaydatesByPeriod(fromDate, toDate, dateFormat, timeZone),
    ]);
    return { byStatus, timeline };
  }
}

export const playdateService = new PlaydateService();
export default playdateService;
