import Subscription from '../../src/modules/subscription/subscription.model.js';

const DAY = 24 * 60 * 60 * 1000;

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
        planCode: 'premium_monthly',
        status: 'active',
        startDate: new Date(),
        endDate: new Date(Date.now() + days * DAY),
      },
    },
    { upsert: true }
  );
}

export default { grantPremium };
