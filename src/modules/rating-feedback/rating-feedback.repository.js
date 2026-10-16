import RatingFeedback from './rating-feedback.model.js';

class RatingFeedbackRepository {
  async create(ratingData) {
    return RatingFeedback.create(ratingData);
  }

  async findDistinctRatedPlaydateIds(parentId) {
    return RatingFeedback.find({ parentId }).distinct('playdateId');
  }

  async findByPlaydate(playdateId) {
    return RatingFeedback.find({ playdateId })
      .populate('parentId', 'fullName avatarUrl')
      .sort({ createdAt: -1 })
      .lean();
  }

  async findByPlaydateAndParent(playdateId, parentId) {
    return RatingFeedback.findOne({ playdateId, parentId }).lean();
  }
}

export default new RatingFeedbackRepository();
