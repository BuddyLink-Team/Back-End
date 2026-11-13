export const NOTIFICATION_TYPES = Object.freeze({
  CONNECTION_REQUEST: 'connection_request',
  CONNECTION_ACCEPTED: 'connection_accepted',
  PLAYDATE_INVITE: 'playdate_invite',
  PLAYDATE_REMINDER: 'playdate_reminder',
  // A family who joined left the host's playdate
  PLAYDATE_LEFT: 'playdate_left',
  // The host or an admin cancelled a playdate the parent was invited to / hosted
  PLAYDATE_CANCELLED: 'playdate_cancelled',
  BADGE_UNLOCKED: 'badge_unlocked',
  STREAK_REMINDER: 'streak_reminder',
  // A plan prepared by the AI assistant (e.g. meeting the same friends again after a good playdate)
  AI_SUGGESTION: 'ai_suggestion',
  SYSTEM: 'system',
});

export const NOTIFICATION_SOCKET_EVENTS = Object.freeze({
  NEW_NOTIFICATION: 'notification:new',
  UNREAD_COUNT: 'notification:unread_count',
  READ: 'notification:read',
  READ_ALL: 'notification:read_all',
});

export const NOTIFICATION_STREAM_RETRY_MS = 5000;

