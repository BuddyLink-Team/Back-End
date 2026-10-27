import safetyRepository from './safety.repository.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import storageAdapter from '../../integrations/storage/storage.adapter.js';
import SafetyDTO from './safety.dto.js';
import { emitSafetyEvent, SAFETY_EVENTS } from './safety.events.js';
import { REPORT_TARGET_TYPES, REPORT_LIMITS, REPORT_CATEGORIES, DEFAULT_BLOCK_REASON } from './safety.constants.js';

class SafetyService {
  /**
   * Get all parentIds that the given parent has blocked or been blocked by.
   * Used by discovery module to exclude blocked users from results.
   * @param {string|mongoose.Types.ObjectId} parentId
   * @returns {Promise<string[]>}
   */
  async getBlockedParentIds(parentId) {
    return safetyRepository.getBlockedParentIds(parentId);
  }

  /**
   * Resolve parent profile from userId or parentId
   * @private
   */
  async _resolveParent(userIdOrParentId) {
    if (!userIdOrParentId) {
      throw new AppError('User or parent ID is required', 400, 'ID_REQUIRED');
    }
    let parent = await parentService.getParentByUserId(userIdOrParentId);
    if (!parent) {
      parent = await parentService.getParentById(userIdOrParentId);
    }
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }
    return parent;
  }

  /**
   * Block a user/parent
   */
  async blockUser(userIdOrParentId, targetParentId, reason = '') {
    const currentParent = await this._resolveParent(userIdOrParentId);
    const targetParent = await parentService.getParentById(targetParentId);

    if (!targetParent) {
      throw new AppError('Target parent not found', 404, 'TARGET_PARENT_NOT_FOUND');
    }

    if (currentParent._id.toString() === targetParent._id.toString()) {
      throw new AppError('Cannot block yourself', 400, 'SELF_BLOCK_NOT_ALLOWED');
    }

    const block = await safetyRepository.upsertBlock(
      currentParent._id,
      targetParent._id,
      reason || DEFAULT_BLOCK_REASON,
    );

    // Other modules react to the block (connection ends any active connection between the two).
    // The block is kept when a reaction fails; blocking again is safe and runs the reactions again.
    const errors = await emitSafetyEvent(SAFETY_EVENTS.USER_BLOCKED, {
      blockerId: currentParent._id.toString(),
      blockedId: targetParent._id.toString(),
    });
    if (errors.length > 0) {
      throw new AppError('The user was blocked but the block could not be completed', 500, 'BLOCK_INCOMPLETE');
    }

    return SafetyDTO.toBlockResponse(block);
  }

  /**
   * Unblock a user/parent
   */
  async unblockUser(userIdOrParentId, targetParentId) {
    const currentParent = await this._resolveParent(userIdOrParentId);
    await safetyRepository.deleteBlock(currentParent._id, targetParentId);
    return { success: true };
  }

  /**
   * Check if any block exists between two parents (in either direction)
   */
  async isBlocked(parentAId, parentBId) {
    if (!parentAId || !parentBId) return false;
    const block = await safetyRepository.findBlockBetween(parentAId, [parentBId]);
    return Boolean(block);
  }

  /**
   * Check if a parent and any of the given parents block each other (in either direction)
   * @param {string|ObjectId} parentId
   * @param {Array<string|ObjectId>} otherParentIds
   * @returns {Promise<boolean>}
   */
  async isBlockedWithAny(parentId, otherParentIds = []) {
    if (!parentId || otherParentIds.length === 0) return false;
    const block = await safetyRepository.findBlockBetween(parentId, otherParentIds);
    return Boolean(block);
  }

  /**
   * Find all active blocks involving a parent (either as blocker or blocked)
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array>}
   */
  async findBlocksInvolving(parentId) {
    if (!parentId) return [];
    return safetyRepository.findBlocksInvolving(parentId);
  }

  /**
   * Check that the reported message / playdate exists, belongs to the reported parent and was
   * visible to the reporter. A user report has no target.
   * The chat and playdate services are loaded on use: both already import this service.
   * @private
   * @param {string} reporterId
   * @param {string} reportedId
   * @param {{ targetType: string, targetMessageId?: string, targetPlaydateId?: string }} target
   */
  async _assertReportTarget(reporterId, reportedId, { targetType, targetMessageId, targetPlaydateId }) {
    if (targetType === REPORT_TARGET_TYPES.MESSAGE) {
      if (!targetMessageId) {
        throw new AppError('targetMessageId is required for a message report', 400, 'REPORT_TARGET_REQUIRED');
      }
      const { default: chatService } = await import('../chat/chat.service.js');
      const message = await chatService.getMessageWithParticipants(targetMessageId);
      if (!message) {
        throw new AppError('Reported message not found', 404, 'REPORT_TARGET_NOT_FOUND');
      }
      if (message.senderId !== reportedId || !message.participantIds.includes(reporterId)) {
        throw new AppError('The message does not belong to the reported user', 400, 'INVALID_REPORT_TARGET');
      }
      return;
    }

    if (targetType === REPORT_TARGET_TYPES.PLAYDATE) {
      if (!targetPlaydateId) {
        throw new AppError('targetPlaydateId is required for a playdate report', 400, 'REPORT_TARGET_REQUIRED');
      }
      const { default: playdateService } = await import('../playdate/playdate.service.js');
      const playdate = await playdateService.getPlaydateById(targetPlaydateId).catch((error) => {
        if (error?.code === 'PLAYDATE_NOT_FOUND') {
          throw new AppError('Reported playdate not found', 404, 'REPORT_TARGET_NOT_FOUND');
        }
        throw error;
      });
      const toId = (ref) => (ref?._id || ref)?.toString();
      // A playdate report is filed against its host by one of its families
      const memberIds = [toId(playdate.hostParentId), ...(playdate.participants || []).map((p) => toId(p.parentId))];
      if (toId(playdate.hostParentId) !== reportedId || !memberIds.includes(reporterId)) {
        throw new AppError('The playdate is not hosted by the reported user', 400, 'INVALID_REPORT_TARGET');
      }
    }
  }

  /**
   * Create a safety report
   */
  async createReport(userIdOrParentId, reportData) {
    const reporter = await this._resolveParent(userIdOrParentId);
    const {
      reportedUserId,
      targetType = REPORT_TARGET_TYPES.USER,
      targetMessageId,
      targetPlaydateId,
      category,
      reason,
      description,
      evidenceUrls,
    } = reportData;

    if (!reportedUserId) {
      throw new AppError('Reported user ID is required', 400, 'REPORTED_USER_REQUIRED');
    }

    if (!category || !Object.values(REPORT_CATEGORIES).includes(category)) {
      throw new AppError('Violation category is required', 400, 'CATEGORY_REQUIRED');
    }

    const reportedParent = await parentService.getParentById(reportedUserId);
    if (!reportedParent) {
      throw new AppError('Reported user not found', 404, 'REPORTED_USER_NOT_FOUND');
    }

    const reporterId = reporter._id.toString();
    const reportedId = reportedParent._id.toString();
    if (reporterId === reportedId) {
      throw new AppError('Cannot report yourself', 400, 'SELF_REPORT_NOT_ALLOWED');
    }

    await this._assertReportTarget(reporterId, reportedId, { targetType, targetMessageId, targetPlaydateId });

    // Evidence must be images uploaded through our own Cloud Storage, never arbitrary links
    const evidence = Array.isArray(evidenceUrls) ? evidenceUrls : [];
    if (evidence.some((url) => !storageAdapter.isOwnedMediaUrl(url))) {
      throw new AppError('Evidence must be images uploaded to BuddyLink', 400, 'INVALID_EVIDENCE_URL');
    }

    // Prevent flooding moderators with repeated reports against the same parent
    const recentReport = await safetyRepository.hasRecentReport(
      reporter._id,
      reportedParent._id,
      new Date(Date.now() - REPORT_LIMITS.DUPLICATE_WINDOW_MS),
    );
    if (recentReport) {
      throw new AppError(
        'You have already reported this user recently. Our team is reviewing it.',
        429,
        'REPORT_TOO_FREQUENT',
      );
    }

    const report = await safetyRepository.createReport({
      reporterId: reporter._id,
      reportedUserId: reportedParent._id,
      targetType,
      // Only the target of the report type is kept
      targetMessageId: targetType === REPORT_TARGET_TYPES.MESSAGE ? targetMessageId : null,
      targetPlaydateId: targetType === REPORT_TARGET_TYPES.PLAYDATE ? targetPlaydateId : null,
      category,
      reason: (reason && reason.trim()) || category,
      description: description || '',
      evidenceUrls: evidence,
    });

    return SafetyDTO.toReportResponse(report);
  }

  /**
   * Get paginated list of parents blocked by the current parent
   * @param {string|ObjectId} userIdOrParentId
   * @param {{ page?: number|string, limit?: number|string, search?: string }} [options]
   * @returns {Promise<{ items: Array<Object>, pagination: Object }>}
   */
  async getBlockedUsers(userIdOrParentId, { page = 1, limit = 10, search = '' } = {}) {
    const currentParent = await this._resolveParent(userIdOrParentId);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const keyword = typeof search === 'string' ? search.trim() : '';
    const blockedIds = keyword ? await parentService.findParentIdsByName(keyword) : undefined;

    const { items, total } = await safetyRepository.findBlockedUsersByBlocker(currentParent._id, {
      page: pageNum,
      limit: limitNum,
      blockedIds,
    });

    return {
      items: items.map((block) => SafetyDTO.toBlockedUserResponse(block)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  /**
   * Upload an evidence image for a report to Cloud Storage
   * @param {{ buffer: Buffer, mimetype: string }} file - Multer file
   * @returns {Promise<{ url: string, publicId: string }>}
   */
  async uploadEvidence(file) {
    if (!file) {
      throw new AppError('No image file uploaded', 400, 'FILE_REQUIRED');
    }
    const result = await storageAdapter.uploadImage(file.buffer, {
      folder: 'buddylink/reports',
      mimetype: file.mimetype,
    });
    return { url: result.url, publicId: result.publicId };
  }
}

export const safetyService = new SafetyService();
export default safetyService;
