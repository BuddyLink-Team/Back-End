import Subscription from './subscription.model.js';
import { SUBSCRIPTION_PLAN_CODES, SUBSCRIPTION_STATUS } from './subscription.constants.js';

// Paid subscription in effect: active and not past its end date
const activePaidFilter = (now) => ({
  status: SUBSCRIPTION_STATUS.ACTIVE,
  planCode: { $ne: SUBSCRIPTION_PLAN_CODES.FREE },
  endDate: { $gt: now },
});

class SubscriptionRepository {
  /**
   * Find subscription by parentId with optional mongoose session
   */
  async findByParentId(parentId, session = null) {
    const query = Subscription.findOne({ parentId });
    if (session) {
      query.session(session);
    }
    return query;
  }

  /**
   * Subscriptions of several parents in one query
   * @param {Array<string|ObjectId>} parentIds
   */
  async findByParentIds(parentIds) {
    if (!parentIds.length) return [];
    return Subscription.find({ parentId: { $in: parentIds } }).lean();
  }

  /**
   * Paid subscriptions in effect (active and not past their end date)
   */
  async countActivePaid(now = new Date()) {
    return Subscription.countDocuments(activePaidFilter(now));
  }

  /**
   * Parents of the paid subscriptions in effect
   * @returns {Promise<Array<ObjectId>>}
   */
  async findActivePaidParentIds(now = new Date()) {
    return Subscription.distinct('parentId', activePaidFilter(now));
  }

  /**
   * Paid subscriptions still marked active whose end date has passed
   */
  async findDueForExpiry(now = new Date()) {
    return Subscription.find({
      status: SUBSCRIPTION_STATUS.ACTIVE,
      planCode: { $ne: SUBSCRIPTION_PLAN_CODES.FREE },
      endDate: { $ne: null, $lte: now },
    });
  }

  /**
   * Move a past-due paid subscription back to Free (one subscription document per parent).
   * Matches only while it is still past due, so a renewal paid in the meantime is never overwritten.
   * @returns {Promise<Object|null>} Downgraded subscription, or null when nothing changed
   */
  async downgradeToFree(id, now = new Date()) {
    return Subscription.findOneAndUpdate(
      {
        _id: id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        planCode: { $ne: SUBSCRIPTION_PLAN_CODES.FREE },
        endDate: { $ne: null, $lte: now },
      },
      {
        $set: {
          planCode: SUBSCRIPTION_PLAN_CODES.FREE,
          startDate: now,
          endDate: null,
          calendarAnchorAt: null,
          purchasedMonths: 0,
        },
      },
      { new: true }
    );
  }

  /**
   * Create a new subscription record
   */
  async create(subscriptionData, session = null) {
    if (session) {
      const created = await Subscription.create([subscriptionData], { session });
      return created[0];
    }
    return Subscription.create(subscriptionData);
  }

  /**
   * Update subscription by parentId
   */
  async updateByParentId(parentId, updateData, session = null) {
    const options = { new: true, runValidators: true };
    if (session) {
      options.session = session;
    }
    return Subscription.findOneAndUpdate({ parentId }, { $set: updateData }, options);
  }

  /**
   * Upsert subscription by parentId
   */
  async upsertSubscription(parentId, subscriptionData, session = null) {
    const options = { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true };
    if (session) {
      options.session = session;
    }
    return Subscription.findOneAndUpdate(
      { parentId },
      { $set: subscriptionData },
      options
    );
  }

  /**
   * Safe upsert for Free subscription if parent does not have one
   */
  async upsertFreeSubscription(parentId, session = null) {
    const options = { upsert: true, new: true, setDefaultsOnInsert: true };
    if (session) {
      options.session = session;
    }
    return Subscription.findOneAndUpdate(
      { parentId },
      {
        $setOnInsert: {
          parentId,
          planCode: SUBSCRIPTION_PLAN_CODES.FREE,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          startDate: new Date(),
          endDate: null,
          calendarAnchorAt: null,
          purchasedMonths: 0,
        },
      },
      options
    );
  }

  async findByIdLean(id) {
    return Subscription.findById(id).lean();
  }

  /**
   * Page of subscriptions for the admin portal, newest first
   * @param {{ planCode?: string, status?: string, parentIds?: Array<ObjectId>|null, page: number, limit: number }} options
   *   parentIds null = any parent
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPageForAdmin({ planCode, status, parentIds = null, page, limit }) {
    const filter = {};
    if (planCode) filter.planCode = planCode;
    if (status) filter.status = status;
    if (parentIds) filter.parentId = { $in: parentIds };

    const [items, total] = await Promise.all([
      Subscription.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Subscription.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Count subscriptions active as of date grouped by planCode
   * @param {Date} [asOfDate]
   * @returns {Promise<{ free: number, premiumMonthly: number, premiumYearly: number }>}
   */
  async countActiveByPlan(asOfDate = new Date()) {
    const rows = await Subscription.aggregate([
      {
        $match: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          $or: [
            { planCode: SUBSCRIPTION_PLAN_CODES.FREE },
            { endDate: { $gt: asOfDate } },
          ],
        },
      },
      { $group: { _id: '$planCode', count: { $sum: 1 } } },
    ]);
    const countOf = (code) => rows.find((r) => r._id === code)?.count || 0;
    return {
      free: countOf(SUBSCRIPTION_PLAN_CODES.FREE),
      premiumMonthly: countOf(SUBSCRIPTION_PLAN_CODES.PREMIUM_MONTHLY),
      premiumYearly: countOf(SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY),
    };
  }
}

export default new SubscriptionRepository();
