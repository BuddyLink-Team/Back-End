import Block from './block.model.js';
import Report from './report.model.js';

class SafetyRepository {
  /**
   * Create or update the block from one parent to another
   * @param {string|ObjectId} blockerId
   * @param {string|ObjectId} blockedId
   * @param {string} reason
   * @returns {Promise<Object>}
   */
  async upsertBlock(blockerId, blockedId, reason) {
    return Block.findOneAndUpdate(
      { blockerId, blockedId },
      { $set: { reason } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  /**
   * Remove the block from one parent to another
   * @param {string|ObjectId} blockerId
   * @param {string|ObjectId} blockedId
   */
  async deleteBlock(blockerId, blockedId) {
    return Block.findOneAndDelete({ blockerId, blockedId });
  }

  /**
   * Find any block between a parent and one of the given parents (in either direction)
   * @param {string|ObjectId} parentId
   * @param {Array<string|ObjectId>} otherParentIds
   * @returns {Promise<Object|null>}
   */
  async findBlockBetween(parentId, otherParentIds) {
    return Block.findOne({
      $or: [
        { blockerId: parentId, blockedId: { $in: otherParentIds } },
        { blockerId: { $in: otherParentIds }, blockedId: parentId },
      ],
    }).lean();
  }

  /**
   * Find all blocks a parent is involved in (as blocker or blocked)
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array>}
   */
  async findBlocksInvolving(parentId) {
    return Block.find({
      $or: [{ blockerId: parentId }, { blockedId: parentId }],
    }).lean();
  }

  /**
   * Check whether a reporter already reported a parent since the given date
   * @param {string|ObjectId} reporterId
   * @param {string|ObjectId} reportedUserId
   * @param {Date} since
   * @returns {Promise<boolean>}
   */
  async hasRecentReport(reporterId, reportedUserId, since) {
    const report = await Report.exists({
      reporterId,
      reportedUserId,
      createdAt: { $gte: since },
    });
    return Boolean(report);
  }

  /**
   * Create a safety report
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async createReport(data) {
    return Report.create(data);
  }
}

export const safetyRepository = new SafetyRepository();
export default safetyRepository;
