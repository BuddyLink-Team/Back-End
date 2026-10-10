import ratingFeedbackRepository from './rating-feedback.repository.js';
import parentService from '../parent/parent.service.js';
import playdateService from '../playdate/playdate.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { ensureRatingEligibility } from './rating-feedback.rules.js';

async function getParent(userId) {
  const parent = await parentService.getParentByUserId(userId);
  if (!parent) throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
  return parent;
}

export async function createRating(userId, playdateId, { rating, feedback = '' }) {
  const parent = await getParent(userId);
  const playdate = await playdateService.findPlaydateDocById(playdateId);
  ensureRatingEligibility(playdate, parent._id);
  let result;
  try {
    result = await ratingFeedbackRepository.create({ playdateId, parentId: parent._id, rating, feedback });
  } catch (error) {
    if (error.code === 11000) throw new AppError('You have already rated this playdate', 409, 'RATING_ALREADY_EXISTS');
    throw error;
  }
  return result;
}

export async function getPendingRatings(userId) {
  const parent = await getParent(userId);
  const ratedIds = await ratingFeedbackRepository.findDistinctRatedPlaydateIds(parent._id);
  return playdateService.getCompletedPlaydatesForParent(parent._id, {
    excludeIds: ratedIds,
    select: 'activity scheduledDate completedAt location.name',
  });
}
