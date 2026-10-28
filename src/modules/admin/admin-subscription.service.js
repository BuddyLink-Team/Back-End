import subscriptionPlanRepository from '../subscription/subscription-plan.repository.js';
import subscriptionRepository from '../subscription/subscription.repository.js';
import paymentRepository from '../subscription/payment.repository.js';
import Parent from '../parent/parent.model.js';
import AppError from '../../shared/exceptions/app-error.js';
import { SUBSCRIPTION_PLAN_CODES } from '../subscription/subscription.constants.js';
import {
  toPlanDto,
  toSubscriptionDto,
  toPaymentSummaryDto,
  toPaymentDetailDto,
} from './admin-subscription.dto.js';

class AdminSubscriptionService {
  /**
   * Get all subscription plans including inactive ones
   */
  async getAllPlans() {
    const plans = await subscriptionPlanRepository.findAll();
    return plans.map(toPlanDto);
  }

  /**
   * Update subscription plan (name, price, features, isActive)
   */
  async updatePlan(id, updateData) {
    const plan = await subscriptionPlanRepository.findById(id);
    if (!plan) {
      throw new AppError('Subscription plan not found', 404, 'PLAN_NOT_FOUND');
    }

    // Protect immutable read-only fields
    const allowedUpdates = { ...updateData };
    delete allowedUpdates.planCode;
    delete allowedUpdates.durationMonths;
    delete allowedUpdates.billingCycle;
    delete allowedUpdates.currency;

    // Free plan constraints
    if (plan.planCode === SUBSCRIPTION_PLAN_CODES.FREE) {
      if (allowedUpdates.price !== undefined && allowedUpdates.price !== 0) {
        throw new AppError('Free plan price must remain 0', 400, 'FREE_PLAN_IMMUTABLE');
      }
      if (allowedUpdates.isActive !== undefined && allowedUpdates.isActive === false) {
        throw new AppError('Free plan cannot be deactivated', 400, 'FREE_PLAN_IMMUTABLE');
      }
    } else {
      // Premium plans constraints
      if (allowedUpdates.price !== undefined && allowedUpdates.price <= 0) {
        throw new AppError('Premium plan price must be greater than 0', 400, 'INVALID_PRICE');
      }
    }

    const payload = {};
    if (allowedUpdates.name !== undefined) payload.name = allowedUpdates.name;
    if (allowedUpdates.price !== undefined) payload.price = allowedUpdates.price;
    if (allowedUpdates.isActive !== undefined) payload.isActive = allowedUpdates.isActive;
    if (allowedUpdates.features) {
      payload.features = {
        ...plan.features.toObject?.() || plan.features,
        ...allowedUpdates.features,
      };
    }

    const updated = await subscriptionPlanRepository.updateById(id, payload);
    return toPlanDto(updated);
  }

  /**
   * Get paginated subscriptions list
   */
  async getSubscriptions(queryParams) {
    const { items, pagination } = await subscriptionRepository.findPaginated(queryParams);
    return {
      items: items.map(toSubscriptionDto),
      pagination,
    };
  }

  /**
   * Get paginated payment transactions list
   */
  async getTransactions(queryParams) {
    const { items, pagination } = await paymentRepository.findPaginated(queryParams);
    return {
      items: items.map(toPaymentSummaryDto),
      pagination,
    };
  }

  /**
   * Get single payment audit detail (checkoutUrl and qrCode omitted)
   */
  async getTransactionDetail(id) {
    const payment = await paymentRepository.findByIdWithDetail(id);
    if (!payment) {
      throw new AppError('Payment transaction not found', 404, 'PAYMENT_NOT_FOUND');
    }
    return toPaymentDetailDto(payment);
  }

  /**
   * Get revenue summary statistics
   */
  async getRevenueSummary({ fromDate, toDate } = {}) {
    // Default to last 6 months if not specified
    const end = toDate ? new Date(toDate) : new Date();
    let start;
    if (fromDate) {
      start = new Date(fromDate);
    } else {
      start = new Date(end);
      start.setMonth(start.getMonth() - 6);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }

    const [metrics, activePremiumSubscribers, totalParents] = await Promise.all([
      paymentRepository.getRevenueMetrics({ fromDate: start, toDate: end }),
      subscriptionRepository.countActivePaid(end),
      Parent.countDocuments(),
    ]);

    // Conversion rate: distinct paying parents / total parents
    const conversionRate =
      totalParents > 0
        ? Number(((metrics.allTimePayingParentsCount / totalParents) * 100).toFixed(1))
        : 0;

    // Churn rate: churned parents in period / active premium at period start
    const churnRate =
      metrics.activeParentsAtStartCount > 0
        ? Number(((metrics.churnedParentsCount / metrics.activeParentsAtStartCount) * 100).toFixed(1))
        : 0;

    return {
      overview: {
        totalRevenue: metrics.totalRevenue,
        successfulTransactions: metrics.successfulTransactions,
        payingParentsCount: metrics.payingParentsCount,
        activePremiumSubscribers,
        conversionRate,
        churnRate,
      },
      monthlyRevenue: metrics.monthlyRevenue,
      filter: {
        fromDate: start.toISOString(),
        toDate: end.toISOString(),
      },
    };
  }
}

export default new AdminSubscriptionService();
