import playdateService from './playdate.service.js';
import { successResponse } from '../../shared/response/index.js';

class PlaydateController {
  /**
   * GET /api/v1/playdates?status=...
   */
  async getPlaydates(req, res, next) {
    try {
      const data = await playdateService.getPlaydates(req.userId, req.query);
      return successResponse(res, data, 'Lấy danh sách buổi hẹn chơi thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/playdates/:id
   */
  async getPlaydateById(req, res, next) {
    try {
      const playdate = await playdateService.getPlaydateById(req.userId, req.params.id);
      return successResponse(res, playdate, 'Lấy thông tin chi tiết buổi hẹn thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/playdates/friends
   */
  async getInvitableFriends(req, res, next) {
    try {
      const friends = await playdateService.getInvitableFriends(req.userId);
      return successResponse(res, friends, 'Lấy danh sách bạn bè kết nối thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/playdates
   */
  async createPlaydate(req, res, next) {
    try {
      const playdate = await playdateService.createPlaydate(req.userId, req.body);
      return successResponse(res, playdate, 'Tạo buổi hẹn chơi thành công', 201);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/playdates/:id/complete
   * Chuyển trạng thái sự kiện sang completed khi host nhấn complete
   */
  async completePlaydate(req, res, next) {
    try {
      const playdate = await playdateService.completePlaydate(req.userId, req.params.id);
      return successResponse(res, playdate, 'Đã chuyển trạng thái sự kiện sang hoàn thành', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/playdates/:id/cancel
   */
  async cancelPlaydate(req, res, next) {
    try {
      const playdate = await playdateService.cancelPlaydate(req.userId, req.params.id, req.body?.reason);
      return successResponse(res, playdate, 'Hủy buổi hẹn chơi thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /api/v1/playdates/:id/respond
   * Phản hồi lời mời (RSVP: accepted / declined)
   */
  async respondToPlaydate(req, res, next) {
    try {
      const playdate = await playdateService.respondToPlaydate(
        req.userId,
        req.params.id,
        req.body.status
      );
      return successResponse(res, playdate, 'Phản hồi lời mời thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/playdates/:id/reschedule
   * Tạo đề xuất đổi lịch
   */
  async createRescheduleRequest(req, res, next) {
    try {
      const result = await playdateService.createRescheduleRequest(
        req.userId,
        req.params.id,
        req.body
      );
      return successResponse(
        res,
        result,
        result.isAutoApplied
          ? 'Đã cập nhật lịch hẹn mới thành công'
          : 'Đã gửi đề xuất đổi lịch đến các phụ huynh tham gia',
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /api/v1/playdates/:id/reschedule/vote
   * Bỏ phiếu đồng ý hoặc từ chối đề xuất đổi lịch
   */
  async voteRescheduleRequest(req, res, next) {
    try {
      const result = await playdateService.voteRescheduleRequest(
        req.userId,
        req.params.id,
        req.body
      );
      return successResponse(res, result, 'Bỏ phiếu đổi lịch thành công', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/playdates/:id/reschedule
   * Lấy đề xuất đổi lịch mới nhất của buổi hẹn
   */
  async getRescheduleRequest(req, res, next) {
    try {
      const result = await playdateService.getRescheduleRequest(req.userId, req.params.id);
      return successResponse(res, result, 'Lấy thông tin đề xuất đổi lịch thành công', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new PlaydateController();
