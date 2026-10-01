import Block from './block.model.js';

class SafetyRepository {
  /**
   * Get all parentIds that the given parent has blocked or been blocked by.
   * Returns a deduplicated array of ObjectId strings excluding the caller.
   * @param {string|mongoose.Types.ObjectId} parentId
   * @returns {Promise<string[]>}
   */
  async getBlockedParentIds(parentId) {
    const blocks = await Block.find({
      $or: [{ blockerId: parentId }, { blockedId: parentId }],
    }).select('blockerId blockedId');

    const ids = new Set();
    blocks.forEach((b) => {
      ids.add(b.blockerId.toString());
      ids.add(b.blockedId.toString());
    });
    ids.delete(parentId.toString());
    return [...ids];
  }

  /**
   * Check if a block relationship exists between two parents (either direction)
   * @param {string|mongoose.Types.ObjectId} parentIdA
   * @param {string|mongoose.Types.ObjectId} parentIdB
   * @returns {Promise<boolean>}
   */
  async isBlocked(parentIdA, parentIdB) {
    const block = await Block.findOne({
      $or: [
        { blockerId: parentIdA, blockedId: parentIdB },
        { blockerId: parentIdB, blockedId: parentIdA },
      ],
    });
    return !!block;
  }
}

export default new SafetyRepository();
