import adminService from './admin.service.js';
import { successResponse } from '../../shared/response/index.js';

class AdminController {
  async getUsers(req, res, next) {
    try {
      const data = await adminService.getUsers(req.query);
      return successResponse(res, data, 'Parent users retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getUserStats(req, res, next) {
    try {
      const data = await adminService.getUserStats();
      return successResponse(res, data, 'Parent statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getUserDetail(req, res, next) {
    try {
      const data = await adminService.getUserDetail(req.params.id);
      return successResponse(res, data, 'Parent user detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async updateUserStatus(req, res, next) {
    try {
      const data = await adminService.updateUserStatus(
        req.user?._id || req.userId,
        req.params.id,
        req.body
      );
      return successResponse(res, data, 'User status updated successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildren(req, res, next) {
    try {
      const data = await adminService.getChildren(req.query);
      return successResponse(res, data, 'Children profiles retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildStats(req, res, next) {
    try {
      const data = await adminService.getChildStats();
      return successResponse(res, data, 'Child profile statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getChildDetail(req, res, next) {
    try {
      const data = await adminService.getChildDetail(req.params.id);
      return successResponse(res, data, 'Child profile detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async getPayments(req, res, next) {
    try {
      const data = await adminService.getPayments(req.query);
      return successResponse(res, data, 'Payments history retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/playdates
   */
  async getPlaydates(req, res, next) {
    try {
      const data = await adminService.getPlaydates(req.query);
      return successResponse(res, data, 'Admin playdates list retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/playdates/stats
   */
  async getPlaydateStats(req, res, next) {
    try {
      const data = await adminService.getPlaydateStats();
      return successResponse(res, data, 'Playdate statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/playdates/:id
   */
  async getPlaydateDetail(req, res, next) {
    try {
      const playdate = await adminService.getPlaydateDetail(req.params.id);
      return successResponse(res, playdate, 'Admin playdate detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/playdates/:id/cancel
   */
  async cancelPlaydate(req, res, next) {
    try {
      const result = await adminService.cancelPlaydate(req.params.id, req.body?.reason);
      return successResponse(res, result, 'Playdate cancelled by admin successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/connections
   */
  async getConnections(req, res, next) {
    try {
      const data = await adminService.getConnections(req.query);
      return successResponse(res, data, 'Admin connections list retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/connections/stats
   */
  async getConnectionStats(req, res, next) {
    try {
      const data = await adminService.getConnectionStats();
      return successResponse(res, data, 'Connection statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/connections/:id
   */
  async getConnectionDetail(req, res, next) {
    try {
      const connection = await adminService.getConnectionDetail(req.params.id);
      return successResponse(res, connection, 'Admin connection detail retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * DELETE /api/v1/admin/connections/:id
   */
  async removeConnection(req, res, next) {
    try {
      const result = await adminService.removeConnection(req.params.id, req.body?.reason);
      return successResponse(res, result, 'Connection removed by admin successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/plans
   */
  async getPlans(req, res, next) {
    try {
      const plans = await adminService.getPlans();
      return successResponse(res, { plans }, 'Subscription plans retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/plans/:id
   */
  async getPlanDetail(req, res, next) {
    try {
      const plan = await adminService.getPlanDetail(req.params.id);
      return successResponse(res, { plan }, 'Subscription plan retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/plans/:id
   */
  async updatePlan(req, res, next) {
    try {
      const plan = await adminService.updatePlan(req.params.id, req.body);
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
      const data = await adminService.getSubscriptions(req.query);
      return successResponse(res, data, 'Subscriptions retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/subscriptions/:id
   */
  async getSubscriptionDetail(req, res, next) {
    try {
      const subscription = await adminService.getSubscriptionDetail(req.params.id);
      return successResponse(res, subscription, 'Subscription retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/transactions
   */
  async getTransactions(req, res, next) {
    try {
      const data = await adminService.getTransactions(req.query);
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
      const payment = await adminService.getTransactionDetail(req.params.id);
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
      const data = await adminService.getRevenueSummary(req.query);
      return successResponse(res, data, 'Revenue summary statistics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/analytics
   */
  async getAnalytics(req, res, next) {
    try {
      const data = await adminService.getAnalytics(req.query);
      return successResponse(res, data, 'System analytics retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/notifications
   */
  async getNotifications(req, res, next) {
    try {
      const adminId = req.user?._id || req.userId;
      const data = await adminService.getNotifications({
        ...req.query,
        adminId,
      });
      return successResponse(res, data, 'Admin notifications retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/admin/notifications/unread-count
   */
  async getUnreadNotificationCount(req, res, next) {
    try {
      const adminId = req.user?._id || req.userId;
      const data = await adminService.getUnreadNotificationCount(adminId);
      return successResponse(res, data, 'Unread notification count retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/notifications/:id/read
   */
  async markNotificationAsRead(req, res, next) {
    try {
      const adminId = req.user?._id || req.userId;
      const data = await adminService.markNotificationAsRead(req.params.id, adminId);
      return successResponse(res, data, 'Notification marked as read successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/notifications/read-all
   */
  async markAllNotificationsAsRead(req, res, next) {
    try {
      const adminId = req.user?._id || req.userId;
      const data = await adminService.markAllNotificationsAsRead(adminId, req.query?.category);
      return successResponse(res, data, 'All notifications marked as read successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new AdminController();
