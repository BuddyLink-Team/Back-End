const DEFAULT_PARENT_NAME = 'Người dùng BuddyLink';

const toIdString = (value) => (value ? (value._id || value).toString() : null);

export class SafetyDTO {
  /**
   * Shape a block for the parent who created it
   * @param {Object} block
   * @returns {{ id: string, parentId: string, reason: string, blockedAt: Date }}
   */
  static toBlockResponse(block) {
    return {
      id: block._id.toString(),
      parentId: toIdString(block.blockedId),
      reason: block.reason || '',
      blockedAt: block.createdAt,
    };
  }

  /**
   * Shape a block (blockedId populated with the blocked parent) for the blocked users list
   * @param {Object} block
   * @returns {{ id: string, parentId: string, fullName: string, avatarUrl: string|null, reason: string, blockedAt: Date }}
   */
  static toBlockedUserResponse(block) {
    const blockedParent = block.blockedId || {};
    return {
      id: block._id.toString(),
      parentId: toIdString(blockedParent),
      fullName: blockedParent.fullName || DEFAULT_PARENT_NAME,
      avatarUrl: blockedParent.avatarUrl || null,
      reason: block.reason || '',
      blockedAt: block.createdAt,
    };
  }

  /**
   * Shape a report for the parent who sent it. Moderation fields (adminNotes, resolvedBy,
   * resolvedAt) stay internal.
   * @param {Object} report
   * @returns {Object}
   */
  static toReportResponse(report) {
    return {
      id: report._id.toString(),
      reportedUserId: toIdString(report.reportedUserId),
      targetType: report.targetType,
      targetMessageId: toIdString(report.targetMessageId),
      targetPlaydateId: toIdString(report.targetPlaydateId),
      category: report.category,
      reason: report.reason || '',
      description: report.description || '',
      evidenceUrls: report.evidenceUrls || [],
      status: report.status,
      createdAt: report.createdAt,
    };
  }
}

export default SafetyDTO;
