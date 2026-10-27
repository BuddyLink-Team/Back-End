const DEFAULT_PARENT_NAME = 'Người dùng BuddyLink';

export class SafetyDTO {
  /**
   * Shape a block (blockedId populated with the blocked parent) for the blocked users list
   * @param {Object} block
   * @returns {{ id: string, parentId: string, fullName: string, avatarUrl: string|null, reason: string, blockedAt: Date }}
   */
  static toBlockedUserResponse(block) {
    const blockedParent = block.blockedId || {};
    return {
      id: block._id.toString(),
      parentId: (blockedParent._id || blockedParent).toString(),
      fullName: blockedParent.fullName || DEFAULT_PARENT_NAME,
      avatarUrl: blockedParent.avatarUrl || null,
      reason: block.reason || '',
      blockedAt: block.createdAt,
    };
  }
}

export default SafetyDTO;
