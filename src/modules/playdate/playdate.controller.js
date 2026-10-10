import playdateService from './playdate.service.js';
import { successResponse } from '../../shared/response/index.js';

class PlaydateController {
  /**
   * GET /api/v1/playdates?status=...
   * Retrieve playdates list with counts and pagination metadata
   */
  async getPlaydates(req, res, next) {
    try {
      const data = await playdateService.getPlaydates(req.userId, req.query);
      return successResponse(res, data, 'Playdates list retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/playdates/:id
   * Retrieve single playdate detail
   */
  async getPlaydateById(req, res, next) {
    try {
      const playdate = await playdateService.getPlaydateForParent(req.userId, req.params.id);
      return successResponse(res, playdate, 'Playdate details retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/playdates/friends
   * Retrieve connected friends eligible for playdate invitation
   */
  async getInvitableFriends(req, res, next) {
    try {
      const friends = await playdateService.getInvitableFriends(req.userId, req.query);
      return successResponse(res, friends, 'Connected friends retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/playdates
   * Create a new playdate
   */
  async createPlaydate(req, res, next) {
    try {
      const playdate = await playdateService.createPlaydate(req.userId, req.body);
      return successResponse(res, playdate, 'Playdate created successfully', 201);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/playdates/:id/complete
   * Mark playdate as completed by host once scheduled time has arrived
   */
  async completePlaydate(req, res, next) {
    try {
      const playdate = await playdateService.completePlaydate(req.userId, req.params.id);
      return successResponse(res, playdate, 'Playdate marked as completed', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/v1/playdates/:id/cancel
   * Cancel an upcoming playdate
   */
  async cancelPlaydate(req, res, next) {
    try {
      const playdate = await playdateService.cancelPlaydate(req.userId, req.params.id, req.body?.reason);
      return successResponse(res, playdate, 'Playdate cancelled successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /api/v1/playdates/:id/respond
   * Respond to playdate invitation (RSVP: accepted / declined)
   */
  async respondToPlaydate(req, res, next) {
    try {
      const playdate = await playdateService.respondToPlaydate(
        req.userId,
        req.params.id,
        req.body.status
      );
      return successResponse(res, playdate, 'RSVP response recorded successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/v1/playdates/:id/reschedule
   * Propose a reschedule for an upcoming playdate
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
          ? 'New schedule updated and auto-applied'
          : 'Reschedule request sent to participants',
        201
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PUT /api/v1/playdates/:id/reschedule/vote
   * Vote on a pending reschedule request
   */
  async voteRescheduleRequest(req, res, next) {
    try {
      const result = await playdateService.voteRescheduleRequest(
        req.userId,
        req.params.id,
        req.body
      );
      return successResponse(res, result, 'Reschedule vote recorded successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/playdates/:id/reschedule
   * Get latest reschedule request for a playdate
   */
  async getRescheduleRequest(req, res, next) {
    try {
      const result = await playdateService.getRescheduleRequest(req.userId, req.params.id);
      return successResponse(res, result, 'Reschedule request retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new PlaydateController();
