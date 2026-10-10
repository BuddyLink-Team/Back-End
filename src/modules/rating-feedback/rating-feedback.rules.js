import AppError from '../../shared/exceptions/AppError.js';

export function ensureRatingEligibility(playdate, parentId) {
  if (!playdate) throw new AppError('Playdate not found', 404, 'PLAYDATE_NOT_FOUND');
  const attended = String(playdate.hostParentId) === String(parentId) || playdate.participants.some(
    p => String(p.parentId) === String(parentId) && p.status === 'accepted',
  );
  if (!attended) throw new AppError('Only parents who attended the playdate can rate it', 403, 'RATING_FORBIDDEN');
  if (playdate.status !== 'completed') {
    throw new AppError('A playdate can only be rated once it is completed', 409, 'PLAYDATE_NOT_COMPLETED');
  }
}
