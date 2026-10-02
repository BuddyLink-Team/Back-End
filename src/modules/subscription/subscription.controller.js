import subscriptionService from './subscription.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
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
      throw new AppError('Chưa tìm thấy hồ sơ phụ huynh', 404, 'PARENT_NOT_FOUND');
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
        'Lấy danh sách gói cước thành công',
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
      const childCount = await childService.countChildrenByParentId(parent._id);

      const quotaData = await subscriptionService.getMySubscriptionQuota(
        parent._id,
        childCount
      );

      return successResponse(
        res,
        quotaData,
        'Lấy thông tin gói cước và hạn mức thành công',
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
        'Khởi tạo liên kết thanh toán PayOS thành công',
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
      return res.status(200).json({
        success: true,
        message: result.message || 'Webhook processed successfully',
        data: result,
        error: null,
      });
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
        'Kiểm tra trạng thái thanh toán thành công',
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
        'Lấy lịch sử giao dịch thành công',
        200
      );
    } catch (error) {
      return next(error);
    }
  }
}

export default new SubscriptionController();
