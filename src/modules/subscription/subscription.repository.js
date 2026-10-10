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
}

export default new SubscriptionRepository();
