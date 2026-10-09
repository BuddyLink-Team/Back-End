import UsageQuota from './usage-quota.model.js';

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
   * Atomically consume one unit only if the counter is still below the limit.
   * Check and increment happen in a single findOneAndUpdate, so concurrent requests cannot
   * both pass the check and exceed the quota.
   * @returns {Promise<Document|null>} Updated quota document, or null when the limit is reached
   */
  async incrementIfBelowLimit(parentId, periodType, periodValue, counterField, limit) {
    const counterPath = `counters.${counterField}`;
    const filter = { parentId, periodType, periodValue, [counterPath]: { $lt: limit } };
    const update = { $inc: { [counterPath]: 1 } };

    try {
      // Upsert creates the period document on first use
      return await UsageQuota.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });
    } catch (error) {
      // Duplicate key: the document already exists (limit reached, or created concurrently).
      // Retry without upsert: it matches only if the counter is still below the limit.
      if (error.code === 11000) {
        return UsageQuota.findOneAndUpdate(filter, update, { new: true });
      }
      throw error;
    }
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
