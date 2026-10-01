import UsageQuota from './usage-quota.model.js';
import { QUOTA_PERIOD_TYPES } from './subscription.constants.js';

class UsageQuotaRepository {
  /**
   * Find quota document by parentId, periodType and periodValue
   */
  async findByParentAndPeriod(parentId, periodType, periodValue) {
    return UsageQuota.findOne({ parentId, periodType, periodValue });
  }

  /**
   * Atomically increment a counter within a quota period, creating record if not present
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {string} periodType 'daily' | 'monthly'
   * @param {string} periodValue 'YYYY-MM-DD' or 'YYYY-MM'
   * @param {string} counterField field name within counters (e.g., 'discoveryViews')
   * @param {number} amount amount to increment (default 1)
   */
  async incrementCounter(parentId, periodType, periodValue, counterField, amount = 1) {
    return UsageQuota.findOneAndUpdate(
      { parentId, periodType, periodValue },
      { $inc: { [`counters.${counterField}`]: amount } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  /**
   * Get quota counters for a given parent and period (returns 0 if not yet initialized)
   */
  async getCounters(parentId, periodType, periodValue) {
    const record = await this.findByParentAndPeriod(parentId, periodType, periodValue);
    return record?.counters || {};
  }
}

export default new UsageQuotaRepository();
