import Subscription from './subscription.model.js';
import subscriptionPlanRepository from './subscription-plan.repository.js';
import { SUBSCRIPTION_PLAN_CODES, SUBSCRIPTION_STATUS } from './subscription.constants.js';

// Paid subscription in effect: active, not on the Free plan and not past its end date
const activePaidFilter = (now, freePlanId) => ({
  status: SUBSCRIPTION_STATUS.ACTIVE,
  planId: { $ne: freePlanId },
  endDate: { $gt: now },
});

const toPlain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/**
 * Subscriptions reference their plan by id (planId). Every subscription this repository returns is a plain
 * object that also carries the code of its plan (planCode), read by the plan rules and the API responses.
 * @param {Object|Array<Object>|null} docOrDocs
 */
const withPlanCode = async (docOrDocs) => {
  const docs = [].concat(docOrDocs || []).filter(Boolean).map(toPlain);
  const codes = await subscriptionPlanRepository.getPlanCodesByIds(docs.map((doc) => doc.planId));
  docs.forEach((doc) => {
    doc.planCode = codes.get(String(doc.planId)) || null;
  });
  return Array.isArray(docOrDocs) ? docs : docs[0] || null;
};

class SubscriptionRepository {
  /**
   * Find subscription by parentId with optional mongoose session
   */
  async findByParentId(parentId, session = null) {
    const query = Subscription.findOne({ parentId }).lean();
    if (session) {
      query.session(session);
    }
    return withPlanCode(await query);
  }

  /**
   * Subscriptions of several parents in one query
   * @param {Array<string|ObjectId>} parentIds
   */
  async findByParentIds(parentIds) {
    if (!parentIds.length) return [];
    return withPlanCode(await Subscription.find({ parentId: { $in: parentIds } }).lean());
  }

  /**
   * Paid subscriptions in effect (active and not past their end date)
   */
  async countActivePaid(now = new Date()) {
    const freePlanId = await subscriptionPlanRepository.getFreePlanId();
    return Subscription.countDocuments(activePaidFilter(now, freePlanId));
  }

  /**
   * Parents of the paid subscriptions in effect
   * @returns {Promise<Array<ObjectId>>}
   */
  async findActivePaidParentIds(now = new Date()) {
    const freePlanId = await subscriptionPlanRepository.getFreePlanId();
    return Subscription.distinct('parentId', activePaidFilter(now, freePlanId));
  }

  /**
   * Paid subscriptions still marked active whose end date has passed
   */
  async findDueForExpiry(now = new Date()) {
    const freePlanId = await subscriptionPlanRepository.getFreePlanId();
    const due = await Subscription.find({
      status: SUBSCRIPTION_STATUS.ACTIVE,
      planId: { $ne: freePlanId },
      endDate: { $ne: null, $lte: now },
    }).lean();
    return withPlanCode(due);
  }

  /**
   * Move a past-due paid subscription back to Free (one subscription document per parent).
   * Matches only while it is still past due, so a renewal paid in the meantime is never overwritten.
   * @returns {Promise<Object|null>} Downgraded subscription, or null when nothing changed
   */
  async downgradeToFree(id, now = new Date()) {
    const freePlanId = await subscriptionPlanRepository.getFreePlanId();
    const downgraded = await Subscription.findOneAndUpdate(
      {
        _id: id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        planId: { $ne: freePlanId },
        endDate: { $ne: null, $lte: now },
      },
      {
        $set: {
          planId: freePlanId,
          startDate: now,
          endDate: null,
          calendarAnchorAt: null,
          purchasedMonths: 0,
        },
      },
      { new: true, lean: true }
    );
    return withPlanCode(downgraded);
  }

  /**
   * Create a new subscription record
   */
  async create(subscriptionData, session = null) {
    if (session) {
      const created = await Subscription.create([subscriptionData], { session });
      return withPlanCode(created[0]);
    }
    return withPlanCode(await Subscription.create(subscriptionData));
  }

  /**
   * Update subscription by parentId
   */
  async updateByParentId(parentId, updateData, session = null) {
    const options = { new: true, runValidators: true, lean: true };
    if (session) {
      options.session = session;
    }
    return withPlanCode(await Subscription.findOneAndUpdate({ parentId }, { $set: updateData }, options));
  }

  /**
   * Upsert subscription by parentId
   */
  async upsertSubscription(parentId, subscriptionData, session = null) {
    const options = { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true, lean: true };
    if (session) {
      options.session = session;
    }
    const subscription = await Subscription.findOneAndUpdate(
      { parentId },
      { $set: subscriptionData },
      options
    );
    return withPlanCode(subscription);
  }

  /**
   * Safe upsert for Free subscription if parent does not have one
   */
  async upsertFreeSubscription(parentId, session = null) {
    const freePlanId = await subscriptionPlanRepository.getFreePlanId();
    const options = { upsert: true, new: true, setDefaultsOnInsert: true, lean: true };
    if (session) {
      options.session = session;
    }
    const subscription = await Subscription.findOneAndUpdate(
      { parentId },
      {
        $setOnInsert: {
          parentId,
          planId: freePlanId,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          startDate: new Date(),
          endDate: null,
          calendarAnchorAt: null,
          purchasedMonths: 0,
        },
      },
      options
    );
    return withPlanCode(subscription);
  }

  async findByIdLean(id) {
    return withPlanCode(await Subscription.findById(id).lean());
  }

  /**
   * Page of subscriptions for the admin portal, newest first
   * @param {{ planCode?: string, status?: string, parentIds?: Array<ObjectId>|null, page: number, limit: number }} options
   *   parentIds null = any parent; planCode is resolved to the plan id
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPageForAdmin({ planCode, status, parentIds = null, page, limit }) {
    const filter = {};
    if (planCode) {
      const planId = await subscriptionPlanRepository.getPlanIdByCode(planCode);
      if (!planId) return { items: [], total: 0 };
      filter.planId = planId;
    }
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
    return { items: await withPlanCode(items), total };
  }

  /**
   * Count subscriptions active as of date grouped by plan
   * @param {Date} [asOfDate]
   * @returns {Promise<{ free: number, premiumMonthly: number, premiumYearly: number }>}
   */
  async countActiveByPlan(asOfDate = new Date()) {
    const freePlanId = await subscriptionPlanRepository.getFreePlanId();
    const rows = await Subscription.aggregate([
      {
        $match: {
          status: SUBSCRIPTION_STATUS.ACTIVE,
          $or: [
            { planId: freePlanId },
            { endDate: { $gt: asOfDate } },
          ],
        },
      },
      { $group: { _id: '$planId', count: { $sum: 1 } } },
    ]);
    const codes = await subscriptionPlanRepository.getPlanCodesByIds(rows.map((row) => row._id));
    const countOf = (code) =>
      rows.filter((row) => codes.get(String(row._id)) === code).reduce((sum, row) => sum + row.count, 0);
    return {
      free: countOf(SUBSCRIPTION_PLAN_CODES.FREE),
      premiumMonthly: countOf(SUBSCRIPTION_PLAN_CODES.PREMIUM_MONTHLY),
      premiumYearly: countOf(SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY),
    };
  }
}

export default new SubscriptionRepository();
