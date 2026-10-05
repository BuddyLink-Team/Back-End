import Block from './block.model.js';
import Report from './report.model.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import storageAdapter from '../../integrations/storage/storage.adapter.js';
import { REPORT_TARGET_TYPES, REPORT_LIMITS } from './safety.constants.js';

class SafetyService {
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

    const block = await Block.findOneAndUpdate(
      {
        blockerId: currentParent._id,
        blockedId: targetParent._id,
      },
      {
        $set: {
          reason: reason || 'Blocked by user',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return block;
  }

  /**
   * Unblock a user/parent
   */
  async unblockUser(userIdOrParentId, targetParentId) {
    const currentParent = await this._resolveParent(userIdOrParentId);
    await Block.findOneAndDelete({
      blockerId: currentParent._id,
      blockedId: targetParentId,
    });
    return { success: true };
  }

  /**
   * Check if any block exists between two parents (in either direction)
   */
  async isBlocked(parentAId, parentBId) {
    if (!parentAId || !parentBId) return false;
    const block = await Block.findOne({
      $or: [
        { blockerId: parentAId, blockedId: parentBId },
        { blockerId: parentBId, blockedId: parentAId },
      ],
    });
    return Boolean(block);
  }

  /**
<<<<<<< HEAD
=======
   * Check if a parent and any of the given parents block each other (in either direction)
   * @param {string|ObjectId} parentId
   * @param {Array<string|ObjectId>} otherParentIds
   * @returns {Promise<boolean>}
   */
  async isBlockedWithAny(parentId, otherParentIds = []) {
    if (!parentId || otherParentIds.length === 0) return false;
    const block = await Block.findOne({
      $or: [
        { blockerId: parentId, blockedId: { $in: otherParentIds } },
        { blockerId: { $in: otherParentIds }, blockedId: parentId },
      ],
    });
    return Boolean(block);
  }

  /**
>>>>>>> 391358474053b19cb54c76f2913bbf74b0e1a098
   * Get all active blocks involving a parent
   */
  async getBlockedUserIds(parentId) {
    if (!parentId) return [];
    const blocks = await Block.find({
      $or: [{ blockerId: parentId }, { blockedId: parentId }],
    }).lean();

    const blockedIds = new Set();
    blocks.forEach((b) => {
      if (b.blockerId.toString() === parentId.toString()) {
        blockedIds.add(b.blockedId.toString());
      } else {
        blockedIds.add(b.blockerId.toString());
      }
    });

    return Array.from(blockedIds);
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
      reason,
      description,
      evidenceUrls,
    } = reportData;

    if (!reportedUserId) {
      throw new AppError('Reported user ID is required', 400, 'REPORTED_USER_REQUIRED');
    }

    if (!reason || !reason.trim()) {
      throw new AppError('Report reason is required', 400, 'REASON_REQUIRED');
    }

    const reportedParent = await parentService.getParentById(reportedUserId);
    if (!reportedParent) {
      throw new AppError('Reported user not found', 404, 'REPORTED_USER_NOT_FOUND');
    }

    if (reporter._id.toString() === reportedParent._id.toString()) {
      throw new AppError('Cannot report yourself', 400, 'SELF_REPORT_NOT_ALLOWED');
    }

    // Evidence must be images uploaded through our own Cloud Storage, never arbitrary links
    const evidence = Array.isArray(evidenceUrls) ? evidenceUrls : [];
    if (evidence.some((url) => !storageAdapter.isOwnedMediaUrl(url))) {
      throw new AppError('Evidence must be images uploaded to BuddyLink', 400, 'INVALID_EVIDENCE_URL');
    }

    // Prevent flooding moderators with repeated reports against the same parent
    const recentReport = await Report.exists({
      reporterId: reporter._id,
      reportedUserId: reportedParent._id,
      createdAt: { $gte: new Date(Date.now() - REPORT_LIMITS.DUPLICATE_WINDOW_MS) },
    });
    if (recentReport) {
      throw new AppError(
        'You have already reported this user recently. Our team is reviewing it.',
        429,
        'REPORT_TOO_FREQUENT'
      );
    }

    const report = await Report.create({
      reporterId: reporter._id,
      reportedUserId: reportedParent._id,
      targetType,
      targetMessageId: targetMessageId || null,
      targetPlaydateId: targetPlaydateId || null,
      reason: reason.trim(),
      description: description || '',
      evidenceUrls: evidence,
    });

    return report;
  }
}

export const safetyService = new SafetyService();
export default safetyService;
