import mongoose from 'mongoose';
import SubscriptionPlan from './subscription-plan.model.js';
import { SUBSCRIPTION_PLAN_CODES, SUBSCRIPTION_PLAN_DEFAULTS } from './subscription.constants.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/app-error.js';

/*
 * Plan id <-> plan code cache. A subscription references its plan by id (subscriptions.planId); the code is what
 * the rules and the API use. Plan ids never change in a database (plans are upserted, never recreated), so the
 * cache only has to be scoped by database (the tests switch databases) and dropped when plans are seeded/edited.
 */
let idByCode = new Map();
let codeById = new Map();
const dbName = () => mongoose.connection.name || 'default';
const codeKey = (planCode) => `${dbName()}:${planCode}`;
const idKey = (id) => `${dbName()}:${String(id)}`;

class SubscriptionPlanRepository {
  async _loadPlanCache() {
    const plans = await SubscriptionPlan.find({}, 'planCode').lean();
    for (const plan of plans) {
      idByCode.set(codeKey(plan.planCode), plan._id);
      codeById.set(idKey(plan._id), plan.planCode);
    }
  }

  invalidatePlanCache() {
    idByCode = new Map();
    codeById = new Map();
  }

  /**
   * Id of a plan by its code (also off sale)
   * @param {string} planCode
   * @returns {Promise<mongoose.Types.ObjectId|null>}
   */
  async getPlanIdByCode(planCode) {
    if (!planCode) return null;
    if (!idByCode.has(codeKey(planCode))) await this._loadPlanCache();
    return idByCode.get(codeKey(planCode)) || null;
  }

  /**
   * Id of the Free plan (seeded at startup)
   * @returns {Promise<mongoose.Types.ObjectId>}
   */
  async getFreePlanId() {
    const id = await this.getPlanIdByCode(SUBSCRIPTION_PLAN_CODES.FREE);
    if (!id) throw new AppError('The Free subscription plan is missing', 500, 'FREE_PLAN_MISSING');
    return id;
  }

  /**
   * Codes of some plans by id
   * @param {Array<string|mongoose.Types.ObjectId>} ids
   * @returns {Promise<Map<string, string>>} id string -> planCode
   */
  async getPlanCodesByIds(ids) {
    const keys = [...new Set(ids.filter(Boolean).map(String))];
    if (keys.some((id) => !codeById.has(idKey(id)))) await this._loadPlanCache();
    return new Map(keys.filter((id) => codeById.has(idKey(id))).map((id) => [id, codeById.get(idKey(id))]));
  }

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
    this.invalidatePlanCache();
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
    } finally {
      this.invalidatePlanCache();
    }
  }
}

export default new SubscriptionPlanRepository();
