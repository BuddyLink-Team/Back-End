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
