import ratingFeedbackRepository from './rating-feedback.repository.js';
import parentService from '../parent/parent.service.js';
import playdateService from '../playdate/playdate.service.js';
import AppError from '../../shared/exceptions/app-error.js';
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

const toId = (ref) => (ref?._id || ref)?.toString();

/**
 * Ratings & feedback of one playdate, visible to its host and invited parents.
 * canRate: the viewer attended, the playdate is completed and they have not rated it yet.
 */
export async function getPlaydateRatings(userId, playdateId) {
  const parent = await getParent(userId);
  const parentId = parent._id.toString();
  const playdate = await playdateService.findPlaydateDocById(playdateId);
  if (!playdate) throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');

  const isHost = toId(playdate.hostParentId) === parentId;
  const participant = (playdate.participants || []).find((p) => toId(p.parentId) === parentId);
  if (!isHost && !participant) {
    throw new AppError('You do not have permission to view this playdate', 403, 'FORBIDDEN_VIEW_PLAYDATE');
  }

  const docs = await ratingFeedbackRepository.findByPlaydate(playdateId);
  const ratings = docs.map((doc) => ({
    id: doc._id.toString(),
    rating: doc.rating,
    feedback: doc.feedback || '',
    createdAt: doc.createdAt,
    isMine: toId(doc.parentId) === parentId,
    parent: {
      id: toId(doc.parentId),
      fullName: doc.parentId?.fullName || '',
      avatarUrl: doc.parentId?.avatarUrl || '',
    },
  }));
  const total = ratings.reduce((sum, item) => sum + item.rating, 0);
  const attended = isHost || participant?.status === 'accepted';

  return {
    summary: {
      count: ratings.length,
      average: ratings.length ? Math.round((total / ratings.length) * 10) / 10 : 0,
    },
    ratings,
    canRate: playdate.status === 'completed' && attended && !ratings.some((item) => item.isMine),
  };
}

export async function getPendingRatings(userId) {
  const parent = await getParent(userId);
  const ratedIds = await ratingFeedbackRepository.findDistinctRatedPlaydateIds(parent._id);
  return playdateService.getCompletedPlaydatesForParent(parent._id, {
    excludeIds: ratedIds,
    select: 'activity scheduledDate completedAt location.name',
  });
}
