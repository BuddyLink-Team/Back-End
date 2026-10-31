export const NOTIFICATION_TYPES = Object.freeze({
  CONNECTION_REQUEST: 'connection_request',
  CONNECTION_ACCEPTED: 'connection_accepted',
  PLAYDATE_INVITE: 'playdate_invite',
  PLAYDATE_REMINDER: 'playdate_reminder',
  BADGE_UNLOCKED: 'badge_unlocked',
  STREAK_REMINDER: 'streak_reminder',
  SYSTEM: 'system',
});

export const NOTIFICATION_SOCKET_EVENTS = Object.freeze({
  NEW_NOTIFICATION: 'notification:new',
  UNREAD_COUNT: 'notification:unread_count',
  READ: 'notification:read',
  READ_ALL: 'notification:read_all',
});

export const NOTIFICATION_STREAM_RETRY_MS = 5000;

