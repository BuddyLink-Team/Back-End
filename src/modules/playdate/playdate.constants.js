export const PLAYDATE_STATUS = Object.freeze({
  UPCOMING: 'upcoming',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const PARTICIPANT_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
});

export const RESCHEDULE_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
});

// Friends returned by GET /playdates/friends (narrow the list with ?search=)
export const INVITABLE_FRIENDS_LIMIT = 50;
