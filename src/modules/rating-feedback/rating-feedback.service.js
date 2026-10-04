import Playdate from '../playdate/playdate.model.js';
import ratingFeedbackRepository from './rating-feedback.repository.js';
import AppError from '../../shared/exceptions/AppError.js';
import { getParent } from '../gamification/gamification.service.js';
import { ensureRatingEligibility } from './rating-feedback.rules.js';
import { completedParticipation } from '../gamification/gamification.rules.js';

export async function createRating(userId, playdateId, { rating, feedback = '' }) {
  const parent = await getParent(userId);
  const playdate = await Playdate.findById(playdateId);
  ensureRatingEligibility(playdate, parent._id);
  let result;
  try {
    result = await ratingFeedbackRepository.create({ playdateId, parentId: parent._id, rating, feedback });
  } catch (error) {
    if (error.code === 11000) throw new AppError('Bạn đã đánh giá Playdate này.', 409, 'RATING_ALREADY_EXISTS');
    throw error;
  }
  return result;
}

export async function getPendingRatings(userId) {
  const parent = await getParent(userId);
  const ratedIds = await ratingFeedbackRepository.findDistinctRatedPlaydateIds(parent._id);
  return Playdate.find({ ...completedParticipation(parent._id), _id: { $nin: ratedIds } })
    .select('activity scheduledDate completedAt location.name')
    .sort({ completedAt: 1, _id: 1 }).lean();
}
