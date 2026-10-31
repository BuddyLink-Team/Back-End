export const CONVERSATION_TYPES = Object.freeze({
  DIRECT: 'direct',
  PLAYDATE: 'playdate',
});

export const MESSAGE_TYPES = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  EMOJI: 'emoji',
  SYSTEM: 'system',
});

// Shown instead of a message removed by a moderator (history, realtime and conversation preview)
export const DELETED_MESSAGE_PLACEHOLDER = 'Tin nhắn này đã bị Quản trị viên gỡ do vi phạm quy tắc cộng đồng.';

export const SOCKET_EVENTS = Object.freeze({
  JOIN_CHAT: 'join_chat',
  LEAVE_CHAT: 'leave_chat',
  SEND_MESSAGE: 'send_message',
  RECEIVE_MESSAGE: 'receive_message',
  TYPING: 'typing',
  USER_TYPING: 'user_typing',
  READ_STATUS: 'read_status',
  MESSAGE_READ: 'message_read',
  CONVERSATION_UPDATED: 'conversation_updated',
  MESSAGE_DELETED: 'message_deleted',
  ACCOUNT_LOCKED: 'account_locked',
  ERROR: 'chat_error',
});
