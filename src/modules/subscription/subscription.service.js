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
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';

// Formats a date as YYYY-MM-DD in the business timezone (en-CA locale uses that order)
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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

    // A paid plan past its end date is expired even if the scheduled job has not run yet
    if (sub && sub.endDate && sub.endDate <= new Date()) {
      await subscriptionRepository.markExpired(sub._id);
      sub = null;
    }

    if (!sub) {
      // Auto-heal by creating free subscription
      sub = await this.createFreeSubscription(parentId);
    }
    return sub;
  }

  /**
   * Expire paid subscriptions whose end date has passed and move those parents back to Free.
   * Run periodically by the subscription expiry job.
   * @returns {Promise<number>} Number of expired subscriptions
   */
  async expireDueSubscriptions(now = new Date()) {
    const dueSubscriptions = await subscriptionRepository.findDueForExpiry(now);
    let expiredCount = 0;

    for (const subscription of dueSubscriptions) {
      const expired = await subscriptionRepository.markExpired(subscription._id);
      if (expired) {
        expiredCount += 1;
        await this.createFreeSubscription(subscription.parentId);
      }
    }

    if (expiredCount > 0) {
      logger.info(`Expired ${expiredCount} subscription(s) and downgraded them to Free`);
    }
    return expiredCount;
  }

  /**
   * Quota period key in the business timezone (Asia/Ho_Chi_Minh by default), so daily quotas reset
   * at local midnight rather than at 00:00 UTC (07:00 in Vietnam)
   * @param {'daily'|'monthly'} periodType
   * @param {Date} date
   */
  getPeriodValue(periodType, date = new Date()) {
    const localDay = dayFormatter.format(date); // YYYY-MM-DD
    if (periodType === QUOTA_PERIOD_TYPES.MONTHLY) {
      return localDay.slice(0, 7);
    }
    return localDay;
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
        `Child profile limit reached (${limit}) for the ${features.planCode} plan. Upgrade to Premium for unlimited child profiles.`,
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

    const periodValue = this.getPeriodValue(periodType);
    const quotaExceeded = () =>
      new AppError(
        `Quota exceeded (${limit}/${limit}) for this feature on the current plan. Upgrade to Premium for unlimited usage.`,
        403,
        'QUOTA_EXCEEDED',
        [{ field: 'actionType', message: actionType }]
      );

    // -1 signifies unlimited (Premium plan); usage is still recorded for statistics
    if (limit === -1) {
      if (consume) {
        await usageQuotaRepository.incrementCounter(parentId, periodType, periodValue, counterField, 1);
      }
      return { allowed: true, remaining: -1, limit: -1 };
    }

    if (!consume) {
      const currentCounters = await usageQuotaRepository.getCounters(parentId, periodType, periodValue);
      const currentUsed = currentCounters[counterField] || 0;
      if (currentUsed >= limit) {
        throw quotaExceeded();
      }
      return { allowed: true, remaining: Math.max(0, limit - currentUsed), limit };
    }

    // Check and consume atomically so concurrent requests cannot exceed the limit
    const updatedQuota = await usageQuotaRepository.incrementIfBelowLimit(
      parentId,
      periodType,
      periodValue,
      counterField,
      limit
    );
    if (!updatedQuota) {
      throw quotaExceeded();
    }

    const used = updatedQuota.counters?.[counterField] || 0;
    return {
      allowed: true,
      remaining: Math.max(0, limit - used),
      limit,
    };
  }
}

export default new SubscriptionService();
