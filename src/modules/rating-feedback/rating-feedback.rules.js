import AppError from '../../shared/exceptions/AppError.js';

export function ensureRatingEligibility(playdate, parentId) {
  if (!playdate) throw new AppError('Không tìm thấy Playdate.', 404, 'PLAYDATE_NOT_FOUND');
  const attended = String(playdate.hostParentId) === String(parentId) || playdate.participants.some(
    p => String(p.parentId) === String(parentId) && p.status === 'accepted',
  );
  if (!attended) throw new AppError('Chỉ phụ huynh đã tham gia mới được đánh giá.', 403, 'RATING_FORBIDDEN');
  if (playdate.status !== 'completed') {
    throw new AppError('Chỉ đánh giá sau khi Playdate hoàn thành.', 409, 'PLAYDATE_NOT_COMPLETED');
  }
}
