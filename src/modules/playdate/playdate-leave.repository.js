import mongoose from 'mongoose';
import PlaydateLeave from './playdate-leave.model.js';

class PlaydateLeaveRepository {
  /**
   * @param {{ playdateId, parentId, leftAt: Date, scheduledStart: Date, hoursBeforeStart: number,
   *   isLate: boolean, safetyExempt: boolean, reason?: string }} data
   */
  async create(data) {
    return PlaydateLeave.create(data);
  }

  /**
   * Leaves of a parent that count for the reliability (safety leaves left out)
   * @param {string|ObjectId} parentId
   * @param {Date} since - Start of the window
   * @returns {Promise<{ leaves: number, lateLeaves: number, lastLateLeaveAt: Date|null, totalLateLeaves: number }>}
   */
  async summarizeForParent(parentId, since) {
    const [row] = await PlaydateLeave.aggregate([
      { $match: { parentId: new mongoose.Types.ObjectId(String(parentId)), safetyExempt: { $ne: true } } },
      {
        $group: {
          _id: null,
          leaves: { $sum: { $cond: [{ $gte: ['$leftAt', since] }, 1, 0] } },
          lateLeaves: { $sum: { $cond: [{ $and: ['$isLate', { $gte: ['$leftAt', since] }] }, 1, 0] } },
          totalLateLeaves: { $sum: { $cond: ['$isLate', 1, 0] } },
          lastLateLeaveAt: { $max: { $cond: ['$isLate', '$leftAt', null] } },
        },
      },
    ]);
    return {
      leaves: row?.leaves || 0,
      lateLeaves: row?.lateLeaves || 0,
      totalLateLeaves: row?.totalLateLeaves || 0,
      lastLateLeaveAt: row?.lastLateLeaveAt || null,
    };
  }
}

export default new PlaydateLeaveRepository();
