import Subscription from '../../src/modules/subscription/subscription.model.js';
import SubscriptionPlan from '../../src/modules/subscription/subscription-plan.model.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Id of a subscription plan by its code (subscriptions reference their plan by id)
 * @param {string} planCode
 */
export async function planIdOf(planCode) {
  const plan = await SubscriptionPlan.findOne({ planCode }).select('_id').lean();
  if (!plan) throw new Error(`No subscription plan ${planCode}`);
  return plan._id;
}

/**
 * Give a parent an active Premium subscription (Free locks every child past the first one)
 * @param {string} parentId
 * @param {number} [days=30] - Days until it ends
 */
export async function grantPremium(parentId, days = 30) {
  await Subscription.updateOne(
    { parentId },
    {
      $set: {
        planId: await planIdOf('premium_monthly'),
        status: 'active',
        startDate: new Date(),
        endDate: new Date(Date.now() + days * DAY),
      },
    },
    { upsert: true }
  );
}

export default { grantPremium, planIdOf };
