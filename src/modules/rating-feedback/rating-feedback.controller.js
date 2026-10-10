import { createRating, getPendingRatings } from './rating-feedback.service.js';
import { successResponse } from '../../shared/response/index.js';

class RatingFeedbackController {
  async getPendingRatings(req, res, next) {
    try {
      const pending = await getPendingRatings(req.userId);
      return successResponse(res, pending, 'Pending ratings retrieved successfully');
    } catch (error) {
      return next(error);
    }
  }

  async createRating(req, res, next) {
    try {
      const rating = await createRating(req.userId, req.params.id, req.body);
      return successResponse(res, rating, 'Rating submitted successfully', 201);
    } catch (error) {
      return next(error);
    }
  }
}

export default new RatingFeedbackController();
