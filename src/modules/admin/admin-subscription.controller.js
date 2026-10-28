import adminSubscriptionService from './admin-subscription.service.js';
import { successResponse } from '../../shared/response/index.js';

class AdminSubscriptionController {
  /**
   * GET /api/v1/admin/plans
   */
  async getPlans(req, res, next) {
    try {
      const plans = await adminSubscriptionService.getAllPlans();
      return successResponse(res, { plans }, 'Subscription plans retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/plans/:id
   */
  async updatePlan(req, res, next) {
    try {
      const plan = await adminSubscriptionService.updatePlan(req.params.id, req.body);
      return successResponse(res, { plan }, 'Subscription plan updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/subscriptions
   */
  async getSubscriptions(req, res, next) {
    try {
      const data = await adminSubscriptionService.getSubscriptions(req.query);
      return successResponse(res, data, 'Subscriptions retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/transactions
   */
  async getTransactions(req, res, next) {
    try {
      const data = await adminSubscriptionService.getTransactions(req.query);
      return successResponse(res, data, 'Payments retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/transactions/:id
   */
  async getTransactionDetail(req, res, next) {
    try {
      const payment = await adminSubscriptionService.getTransactionDetail(req.params.id);
      return successResponse(res, payment, 'Payment detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/revenue/summary
   */
  async getRevenueSummary(req, res, next) {
    try {
      const data = await adminSubscriptionService.getRevenueSummary(req.query);
      return successResponse(res, data, 'Revenue summary statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new AdminSubscriptionController();
