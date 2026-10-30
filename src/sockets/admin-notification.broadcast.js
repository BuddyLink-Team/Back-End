import { getAdminIO } from '../config/socket.js';
import { ADMIN_SOCKET_EVENTS, ADMIN_SOCKET_ROOM } from '../modules/admin/admin.constants.js';

/**
 * Send a new notification to the connected admins.
 * Does nothing in a process that has no /admin namespace (the parent API in production).
 * @param {Object} notification - AdminNotificationDTO
 */
export const broadcastAdminNotification = (notification) => {
  getAdminIO()?.to(ADMIN_SOCKET_ROOM).emit(ADMIN_SOCKET_EVENTS.NOTIFICATION_NEW, notification);
};

/**
 * Send the unread counts to the connected admins.
 * @param {{ total: number, byCategory: Record<string, number> }} counts
 */
export const broadcastAdminUnreadCount = (counts) => {
  getAdminIO()?.to(ADMIN_SOCKET_ROOM).emit(ADMIN_SOCKET_EVENTS.UNREAD_COUNT, counts);
};
