import Subscription from './subscription.model.js';

class SubscriptionRepository {
  async findByParentId(parentId) {
    return Subscription.findOne({ parentId }).sort({ createdAt: -1 });
  }

  async findActiveByParentId(parentId) {
    return Subscription.findOne({
      parentId,
      status: 'active',
    }).sort({ createdAt: -1 });
  }

  /**
   * Paid subscriptions still marked active whose end date has passed
   */
  async findDueForExpiry(now = new Date()) {
    return Subscription.find({
      status: 'active',
      endDate: { $ne: null, $lte: now },
    });
  }

  async markExpired(id) {
    return Subscription.findOneAndUpdate(
      { _id: id, status: 'active' },
      { $set: { status: 'expired' } },
      { new: true }
    );
  }

  async create(subscriptionData) {
    return Subscription.create(subscriptionData);
  }

  async updateById(id, updateData) {
    return Subscription.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }
}

export default new SubscriptionRepository();
