import subscriptionService from './subscription.service.js';
import parentService from '../parent/parent.service.js';
import SubscriptionDTO from './subscription.dto.js';
import { successResponse } from '../../shared/response/index.js';
import AppError from '../../shared/exceptions/AppError.js';

class SubscriptionController {
  constructor() {
    this._getParent = this._getParent.bind(this);
    this.getActivePlans = this.getActivePlans.bind(this);
    this.getMySubscriptionQuota = this.getMySubscriptionQuota.bind(this);
    this.createCheckout = this.createCheckout.bind(this);
    this.handleWebhook = this.handleWebhook.bind(this);
    this.verifyPayment = this.verifyPayment.bind(this);
    this.getPaymentHistory = this.getPaymentHistory.bind(this);
  }
  /**
   * Helper to resolve parentId from authenticated request userId
   */
  async _getParent(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }
    return parent;
  }

  /**
   * GET /api/v1/subscriptions/plans
   * Get all active subscription plans
   */
  async getActivePlans(req, res, next) {
    try {
      const plans = await subscriptionService.getActivePlans();
      return successResponse(
        res,
        SubscriptionDTO.toPlanListResponse(plans),
        'Subscription plans retrieved successfully',
        200
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/subscriptions/my
   * Get authenticated parent's active subscription status and usage quota details
   */
  async getMySubscriptionQuota(req, res, next) {
    try {
      const parent = await this._getParent(req.userId);
      const quotaData = await subscriptionService.getMySubscriptionQuota(parent._id);

      return successResponse(
        res,
        quotaData,
        'Subscription and quota retrieved successfully',
        200
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/subscriptions/checkout
   * Initiate a PayOS checkout payment session
   */
  async createCheckout(req, res, next) {
    try {
      const parent = await this._getParent(req.userId);
      const { planCode, fingerprint } = req.body;
      const idempotencyKey = req.header('Idempotency-Key') || null;

      const checkoutSession = await subscriptionService.createCheckoutSession(
        parent._id,
        {
          planCode,
          idempotencyKey,
          fingerprint,
        }
      );

      const statusCode = checkoutSession.isExisting ? 200 : 201;

      return successResponse(
        res,
        SubscriptionDTO.toCheckoutResponse(checkoutSession),
        'Checkout session created successfully',
        statusCode
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/subscriptions/webhook
   * Public PayOS IPN webhook handler
   */
  async handleWebhook(req, res, next) {
    try {
      const result = await subscriptionService.handlePayOSWebhook(req.body);
      return successResponse(res, result, result.message || 'Webhook processed successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/subscriptions/payments/verify/:orderCode
   * Verify and reconcile payment status by orderCode
   */
  async verifyPayment(req, res, next) {
    try {
      const parent = await this._getParent(req.userId);
      const { orderCode } = req.params;

      const paymentResult = await subscriptionService.verifyPayment(
        parent._id,
        orderCode
      );

      return successResponse(
        res,
        paymentResult,
        'Payment status retrieved successfully',
        200
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/subscriptions/payments/history
   * Get paginated payment history for authenticated parent
   */
  async getPaymentHistory(req, res, next) {
    try {
      const parent = await this._getParent(req.userId);
      const { page, limit } = req.query;

      const historyData = await subscriptionService.getPaymentHistory(parent._id, {
        page,
        limit,
      });

      return successResponse(
        res,
        historyData,
        'Payment history retrieved successfully',
        200
      );
    } catch (error) {
      return next(error);
    }
  }
}

export default new SubscriptionController();
