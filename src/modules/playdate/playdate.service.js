import playdateRepository from './playdate.repository.js';
import { PARTICIPANT_STATUS } from './playdate.constants.js';
import AppError from '../../shared/exceptions/AppError.js';

class PlaydateService {
  /**
   * Get playdate by ID
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
}

export const playdateService = new PlaydateService();
export default playdateService;
