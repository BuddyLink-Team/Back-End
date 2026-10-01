import subscriptionService from './subscription.service.js';
import parentService from '../parent/parent.service.js';
import { successResponse } from '../../shared/response/index.js';

class SubscriptionController {
  /**
   * GET /api/v1/subscriptions/plans
   * Get all active subscription plans
   */
  async getActivePlans(req, res, next) {
    try {
      const plans = await subscriptionService.getActivePlans();
      return successResponse(res, plans, 'Lấy danh sách gói cước thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/subscriptions/my
   * Get authenticated parent's active subscription and usage quota summary
   */
  async getMySubscriptionQuota(req, res, next) {
    try {
      const parent = await parentService.getParentByUserId(req.userId);
      if (!parent) {
        return successResponse(res, null, 'Chưa tìm thấy hồ sơ phụ huynh', 200);
      }

      const [subscription, quotaSummary] = await Promise.all([
        subscriptionService.getActiveSubscriptionByParentId(parent._id),
        subscriptionService.getQuotaSummary(parent._id),
      ]);

      return successResponse(
        res,
        {
          subscription,
          quota: quotaSummary,
        },
        'Lấy thông tin gói cước và hạn mức thành công',
        200
      );
    } catch (error) {
      return next(error);
    }
  }
}

export default new SubscriptionController();
