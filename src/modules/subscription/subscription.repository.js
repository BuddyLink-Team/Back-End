import Subscription from './subscription.model.js';
import { SUBSCRIPTION_PLAN_CODES, SUBSCRIPTION_STATUS } from './subscription.constants.js';

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

  /**
   * Count active premium subscriptions whose end date is in the future
   */
  async countActivePremium(now = new Date()) {
    return Subscription.countDocuments({
      status: SUBSCRIPTION_STATUS.ACTIVE,
      planCode: { $in: [SUBSCRIPTION_PLAN_CODES.PREMIUM_MONTHLY, SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY] },
      endDate: { $gt: now },
    });
  }

  /**
   * Paginated list of subscriptions with parent and user lookup for admin portal
   */
  async findPaginated({ planCode, status, search, page = 1, limit = 10 } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (parsedPage - 1) * parsedLimit;

    const pipeline = [
      {
        $lookup: {
          from: 'parents',
          localField: 'parentId',
          foreignField: '_id',
          as: 'parent',
        },
      },
      {
        $unwind: {
          path: '$parent',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'parent.userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    const matchConditions = {};

    if (planCode) {
      matchConditions.planCode = planCode;
    }

    if (status) {
      matchConditions.status = status;
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matchConditions.$or = [
        { 'parent.fullName': { $regex: escaped, $options: 'i' } },
        { 'user.email': { $regex: escaped, $options: 'i' } },
      ];
    }

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    pipeline.push({
      $facet: {
        items: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: parsedLimit },
          {
            $project: {
              _id: 1,
              parentId: 1,
              planCode: 1,
              status: 1,
              startDate: 1,
              endDate: 1,
              purchasedMonths: 1,
              createdAt: 1,
              parent: {
                _id: '$parent._id',
                fullName: '$parent.fullName',
                avatarUrl: '$parent.avatarUrl',
                email: '$user.email',
              },
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    });

    const result = await Subscription.aggregate(pipeline);
    const items = result[0]?.items || [];
    const total = result[0]?.totalCount[0]?.count || 0;

    return {
      items,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }
}

export default new SubscriptionRepository();
