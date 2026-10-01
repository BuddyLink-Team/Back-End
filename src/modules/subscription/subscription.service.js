import subscriptionRepository from './subscription.repository.js';
import subscriptionPlanRepository from './subscription-plan.repository.js';
import usageQuotaRepository from './usage-quota.repository.js';
import childService from '../child/child.service.js';
import {
  SUBSCRIPTION_PLAN_CODES,
  SUBSCRIPTION_STATUS,
  QUOTA_PERIOD_TYPES,
} from './subscription.constants.js';
import AppError from '../../shared/exceptions/AppError.js';

class SubscriptionService {
  /**
   * Seed default subscription plans
   */
  async seedSubscriptionPlans() {
    return subscriptionPlanRepository.seedDefaultPlans();
  }

  /**
   * Get all active subscription plans
   */
  async getActivePlans() {
    return subscriptionPlanRepository.findAllActive();
  }

  /**
   * Get subscription plan by code
   * @param {string} planCode
   */
  async getPlanByCode(planCode) {
    return subscriptionPlanRepository.findByPlanCode(planCode);
  }

  /**
   * Create default Free subscription for a parent
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async createFreeSubscription(parentId) {
    const existingActive = await subscriptionRepository.findActiveByParentId(parentId);
    if (existingActive) {
      return existingActive;
    }

    return subscriptionRepository.create({
      parentId,
      planCode: SUBSCRIPTION_PLAN_CODES.FREE,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      startDate: new Date(),
      endDate: null, // Free plan has no expiration
      autoRenew: false,
    });
  }

  /**
   * Get subscription by parentId
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getSubscriptionByParentId(parentId) {
    return subscriptionRepository.findByParentId(parentId);
  }

  /**
   * Get active subscription by parentId (defaults to Free if none found)
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getActiveSubscriptionByParentId(parentId) {
    let sub = await subscriptionRepository.findActiveByParentId(parentId);
    if (!sub) {
      // Auto-heal by creating free subscription
      sub = await this.createFreeSubscription(parentId);
    }
    return sub;
  }

  /**
   * Helper to format current date string
   * @param {'daily'|'monthly'} periodType
   * @param {Date} date
   */
  getPeriodValue(periodType, date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    if (periodType === QUOTA_PERIOD_TYPES.MONTHLY) {
      return `${yyyy}-${mm}`;
    }
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Get current parent plan features and active limits
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getParentPlanFeatures(parentId) {
    const subscription = await this.getActiveSubscriptionByParentId(parentId);
    const plan = await subscriptionPlanRepository.findByPlanCode(subscription.planCode);

    if (!plan) {
      // Fallback to default free plan features
      return {
        planCode: SUBSCRIPTION_PLAN_CODES.FREE,
        childProfilesLimit: 1,
        discoveryViewLimitPerDay: 5,
        connectionRequestsLimitPerMonth: 5,
        playdatesLimitPerMonth: 3,
        playdateParticipationLimitPerMonth: 3,
        aiAssistantLimitPerMonth: 5,
      };
    }

    return {
      planCode: plan.planCode,
      ...plan.features.toObject ? plan.features.toObject() : plan.features,
    };
  }

  /**
   * Get current usage quota summary for a parent
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getQuotaSummary(parentId) {
    const features = await this.getParentPlanFeatures(parentId);
    const todayStr = this.getPeriodValue(QUOTA_PERIOD_TYPES.DAILY);
    const thisMonthStr = this.getPeriodValue(QUOTA_PERIOD_TYPES.MONTHLY);

    const [dailyCounters, monthlyCounters, childCount] = await Promise.all([
      usageQuotaRepository.getCounters(parentId, QUOTA_PERIOD_TYPES.DAILY, todayStr),
      usageQuotaRepository.getCounters(parentId, QUOTA_PERIOD_TYPES.MONTHLY, thisMonthStr),
      childService.countChildrenByParentId(parentId),
    ]);

    return {
      planCode: features.planCode,
      limits: {
        childProfiles: features.childProfilesLimit,
        discoveryViewsPerDay: features.discoveryViewLimitPerDay,
        connectionRequestsPerMonth: features.connectionRequestsLimitPerMonth,
        playdatesCreatedPerMonth: features.playdatesLimitPerMonth,
        playdatesParticipatedPerMonth: features.playdateParticipationLimitPerMonth,
        aiAssistantRequestsPerMonth: features.aiAssistantLimitPerMonth,
      },
      usage: {
        childProfiles: childCount || 0,
        discoveryViewsToday: dailyCounters.discoveryViews || 0,
        connectionRequestsThisMonth: monthlyCounters.connectionRequests || 0,
        playdatesCreatedThisMonth: monthlyCounters.playdatesCreated || 0,
        playdatesParticipatedThisMonth: monthlyCounters.playdatesParticipated || 0,
        aiAssistantRequestsThisMonth: monthlyCounters.aiAssistantRequests || 0,
      },
    };
  }

  /**
   * Check if parent has reached child profile limit
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async checkChildProfileQuota(parentId) {
    const features = await this.getParentPlanFeatures(parentId);
    const limit = features.childProfilesLimit;

    // -1 signifies unlimited (Premium plan)
    if (limit === -1) {
      return { allowed: true, remaining: -1, limit: -1 };
    }

    const currentCount = await childService.countChildrenByParentId(parentId);
    if (currentCount >= limit) {
      throw new AppError(
        `Bạn đã tạo tối đa ${limit} hồ sơ bé cho gói ${features.planCode === SUBSCRIPTION_PLAN_CODES.FREE ? 'Miễn phí' : 'hiện tại'}. Vui lòng nâng cấp lên Premium để quản lý không giới hạn số bé!`,
        403,
        'CHILD_QUOTA_EXCEEDED'
      );
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - (currentCount + 1)),
      limit,
    };
  }

  /**
   * Check if action is within quota and consume if allowed
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {'discovery'|'connectionRequest'|'playdateCreate'|'playdateParticipate'|'aiAssistant'} actionType
   * @param {boolean} consume If true, increments counter immediately
   */
  async checkAndConsumeQuota(parentId, actionType, consume = true) {
    const features = await this.getParentPlanFeatures(parentId);

    let periodType;
    let limit;
    let counterField;

    switch (actionType) {
      case 'discovery':
        periodType = QUOTA_PERIOD_TYPES.DAILY;
        limit = features.discoveryViewLimitPerDay;
        counterField = 'discoveryViews';
        break;

      case 'connectionRequest':
        periodType = QUOTA_PERIOD_TYPES.MONTHLY;
        limit = features.connectionRequestsLimitPerMonth;
        counterField = 'connectionRequests';
        break;

      case 'playdateCreate':
        periodType = QUOTA_PERIOD_TYPES.MONTHLY;
        limit = features.playdatesLimitPerMonth;
        counterField = 'playdatesCreated';
        break;

      case 'playdateParticipate':
        periodType = QUOTA_PERIOD_TYPES.MONTHLY;
        limit = features.playdateParticipationLimitPerMonth;
        counterField = 'playdatesParticipated';
        break;

      case 'aiAssistant':
        periodType = QUOTA_PERIOD_TYPES.MONTHLY;
        limit = features.aiAssistantLimitPerMonth;
        counterField = 'aiAssistantRequests';
        break;

      default:
        throw new AppError(`Unknown actionType: ${actionType}`, 400, 'INVALID_QUOTA_ACTION');
    }

    // -1 signifies unlimited (Premium plan)
    if (limit === -1) {
      if (consume) {
        const periodValue = this.getPeriodValue(periodType);
        await usageQuotaRepository.incrementCounter(parentId, periodType, periodValue, counterField, 1);
      }
      return { allowed: true, remaining: -1, limit: -1 };
    }

    const periodValue = this.getPeriodValue(periodType);
    const currentCounters = await usageQuotaRepository.getCounters(parentId, periodType, periodValue);
    const currentUsed = currentCounters[counterField] || 0;

    if (currentUsed >= limit) {
      throw new AppError(
        `Bạn đã sử dụng hết hạn mức (${currentUsed}/${limit}) cho tính năng này trong gói hiện tại. Vui lòng nâng cấp lên Premium để tiếp tục không giới hạn!`,
        403,
        'QUOTA_EXCEEDED'
      );
    }

    if (consume) {
      await usageQuotaRepository.incrementCounter(parentId, periodType, periodValue, counterField, 1);
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - (currentUsed + (consume ? 1 : 0))),
      limit,
    };
  }
}

export default new SubscriptionService();
