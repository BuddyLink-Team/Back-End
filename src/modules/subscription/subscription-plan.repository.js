import SubscriptionPlan from './subscription-plan.model.js';
import { SUBSCRIPTION_PLAN_DEFAULTS } from './subscription.constants.js';
import logger from '../../shared/logger/index.js';

class SubscriptionPlanRepository {
  async findAll() {
    return SubscriptionPlan.find().sort({ price: 1 });
  }

  async findAllActive() {
    return SubscriptionPlan.find({ isActive: true }).sort({ price: 1 });
  }

  async findByPlanCode(planCode) {
    return SubscriptionPlan.findOne({ planCode, isActive: true });
  }

  /**
   * Plan by code, also when taken off sale (its limits still apply to the parents who bought it)
   */
  async findByPlanCodeAnyStatus(planCode) {
    return SubscriptionPlan.findOne({ planCode }).lean();
  }

  async findById(id) {
    return SubscriptionPlan.findById(id);
  }

  async updateById(id, updateData) {
    return SubscriptionPlan.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  /**
   * Seed default subscription plans into database if they do not exist
   * Safe iteration without overwriting existing configured prices
   */
  async seedDefaultPlans() {
    try {
      for (const defaultPlan of SUBSCRIPTION_PLAN_DEFAULTS) {
        const existing = await SubscriptionPlan.findOne({ planCode: defaultPlan.planCode });
        if (!existing) {
          await SubscriptionPlan.create(defaultPlan);
          logger.info(`Seeded new subscription plan: ${defaultPlan.planCode}`);
        }
      }
    } catch (error) {
      logger.error(`Error seeding subscription plans: ${error.message}`);
    }
  }
}

export default new SubscriptionPlanRepository();
