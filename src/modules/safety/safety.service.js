import Block from './block.model.js';
import Report from './report.model.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { REPORT_TARGET_TYPES } from './safety.constants.js';

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
          reason: reason || 'Người dùng bị chặn',
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

    const report = await Report.create({
      reporterId: reporter._id,
      reportedUserId: reportedParent._id,
      targetType,
      targetMessageId: targetMessageId || null,
      targetPlaydateId: targetPlaydateId || null,
      reason: reason.trim(),
      description: description || '',
      evidenceUrls: evidenceUrls || [],
    });

    return report;
  }
}

export const safetyService = new SafetyService();
export default safetyService;
