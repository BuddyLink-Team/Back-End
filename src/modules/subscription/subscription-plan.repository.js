import SubscriptionPlan from './subscription-plan.model.js';
import { SUBSCRIPTION_PLAN_DEFAULTS } from './subscription.constants.js';
import logger from '../../shared/logger/index.js';

class SubscriptionPlanRepository {
  async findAllActive() {
    return SubscriptionPlan.find({ isActive: true });
  }

  async findByPlanCode(planCode) {
    return SubscriptionPlan.findOne({ planCode });
  }

  async upsertPlan(planData) {
    return SubscriptionPlan.findOneAndUpdate(
      { planCode: planData.planCode },
      { $set: planData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  /**
   * Seed default subscription plans into database if they do not exist
   */
  async seedDefaultPlans() {
    try {
      for (const defaultPlan of SUBSCRIPTION_PLAN_DEFAULTS) {
        await this.upsertPlan(defaultPlan);
      }
      logger.info('Subscription plans seeded/verified successfully.');
    } catch (error) {
      logger.error(`Error seeding subscription plans: ${error.message}`);
    }
  }
}

export default new SubscriptionPlanRepository();
