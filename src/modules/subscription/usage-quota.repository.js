import UsageQuota from './usage-quota.model.js';

class UsageQuotaRepository {
  /**
   * Find quota document by parentId, periodType, and periodValue
   */
  async findByParentAndPeriod(parentId, periodType, periodValue, session = null) {
    const query = UsageQuota.findOne({ parentId, periodType, periodValue });
    if (session) {
      query.session(session);
    }
    return query;
  }

  /**
   * Get quota counters for a given parent and period (returns empty object if not found)
   */
  async getCounters(parentId, periodType, periodValue) {
    const record = await this.findByParentAndPeriod(parentId, periodType, periodValue);
    return record?.counters || {};
  }

  /**
   * Atomically increment a counter within a quota period, creating record if not present
   */
  async incrementCounter(parentId, periodType, periodValue, counterField, amount = 1, session = null) {
    const options = { upsert: true, new: true, setDefaultsOnInsert: true };
    if (session) {
      options.session = session;
    }
    return UsageQuota.findOneAndUpdate(
      { parentId, periodType, periodValue },
      { $inc: { [`counters.${counterField}`]: amount } },
      options
    );
  }

  /**
   * Atomically check and consume quota for limited actions
   * Ensures race condition safety when multiple requests arrive simultaneously
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {string} periodType
   * @param {string} periodValue
   * @param {string} counterField
   * @param {number} limit (-1 for unlimited, or positive integer)
   * @param {mongoose.ClientSession} session
   * @returns {Promise<{ allowed: boolean, currentUsed: number }>}
   */
  async atomicCheckAndConsume(parentId, periodType, periodValue, counterField, limit, session = null) {
    if (limit === -1) {
      const updated = await this.incrementCounter(
        parentId,
        periodType,
        periodValue,
        counterField,
        1,
        session
      );
      return {
        allowed: true,
        currentUsed: updated?.counters?.[counterField] || 1,
      };
    }

    // For bounded limits, try atomic conditional increment
    const options = { new: true };
    if (session) {
      options.session = session;
    }

    // 1. Try updating existing document where counter is strictly below limit
    let doc = await UsageQuota.findOneAndUpdate(
      {
        parentId,
        periodType,
        periodValue,
        [`counters.${counterField}`]: { $lt: limit },
      },
      {
        $inc: { [`counters.${counterField}`]: 1 },
      },
      options
    );

    if (doc) {
      return {
        allowed: true,
        currentUsed: doc.counters[counterField],
      };
    }

    // 2. If document did not exist yet or field is missing, atomically upsert initial counter
    const existing = await this.findByParentAndPeriod(parentId, periodType, periodValue, session);
    if (!existing || existing.counters?.[counterField] === undefined) {
      try {
        const initialized = await UsageQuota.findOneAndUpdate(
          {
            parentId,
            periodType,
            periodValue,
            [`counters.${counterField}`]: { $exists: false },
          },
          {
            $set: { [`counters.${counterField}`]: 1 },
            $setOnInsert: { parentId, periodType, periodValue },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true, session: session || undefined }
        );

        if (initialized) {
          return {
            allowed: true,
            currentUsed: initialized.counters?.[counterField] || 1,
          };
        }
      } catch (err) {
        // Concurrency collision on unique index { parentId, periodType, periodValue }
        // Retry atomic conditional update below
      }
    }

    // 3. Retry atomic increment in case of race condition during document initialization
    doc = await UsageQuota.findOneAndUpdate(
      {
        parentId,
        periodType,
        periodValue,
        [`counters.${counterField}`]: { $lt: limit },
      },
      {
        $inc: { [`counters.${counterField}`]: 1 },
      },
      options
    );

    if (doc) {
      return {
        allowed: true,
        currentUsed: doc.counters[counterField],
      };
    }

    const currentDoc = await this.findByParentAndPeriod(parentId, periodType, periodValue, session);
    const currentUsed = currentDoc?.counters?.[counterField] ?? limit;
    return {
      allowed: false,
      currentUsed,
    };
  }
}

export default new UsageQuotaRepository();
