import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/app-error.js';
import { supportsChangeStreams } from '../../shared/helpers/transaction.helper.js';
import { broadcastAdminNotification, broadcastAdminUnreadCount } from '../../sockets/admin-notification.broadcast.js';
import adminNotificationRepository from './admin-notification.repository.js';
import { ADMIN_NOTIFICATION_STREAM_RETRY_MS } from './admin.constants.js';
import { AdminNotificationDTO } from './admin.dto.js';

class AdminNotificationService {
  constructor() {
    this.stream = null;
    this.retryTimer = null;
  }

  /**
   * Save a notification. Admins get it from the change stream when one is open (see startRealtimeBroadcast);
   * without one (standalone MongoDB, one process) it is sent right away.
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async createNotification(data) {
    const created = await adminNotificationRepository.create(data);
    const notification = created.toObject ? created.toObject() : created;
    if (!this.stream) await this._broadcastNew(notification);
    return notification;
  }

  /**
   * Save a notification unless one of the same type was created within the window.
   * For events anyone can trigger, like a PayOS webhook with a bad signature.
   * @param {Object} data
   * @param {number} windowMs
   * @returns {Promise<Object|null>} null when skipped
   */
  async createThrottledNotification(data, windowMs) {
    const since = new Date(Date.now() - windowMs);
    if (await adminNotificationRepository.existsOfTypeSince(data.type, since)) return null;
    return this.createNotification(data);
  }

  /**
   * Page of notifications with the read state of an admin
   * @param {{ category?: string, severity?: string, isRead?: boolean, adminId: string, page: number, limit: number }} options
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async getNotificationPage(options) {
    const { items, total } = await adminNotificationRepository.findPage(options);
    return { items: items.map((item) => AdminNotificationDTO.toResponse(item, options.adminId)), total };
  }

  /**
   * Unread notifications of an admin, overall and by category
   * @param {string} adminId
   */
  async getUnreadCount(adminId) {
    return adminNotificationRepository.countUnread(adminId);
  }

  /**
   * @param {string} id
   * @param {string} adminId
   * @returns {Promise<Object>}
   */
  async markAsRead(id, adminId) {
    const updated = await adminNotificationRepository.markAsRead(id, adminId);
    if (!updated) {
      throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
    }
    await this._broadcastUnreadCount(adminId);
    return AdminNotificationDTO.toResponse(updated, adminId);
  }

  /**
   * @param {string} adminId
   * @param {string} [category]
   * @returns {Promise<{ modifiedCount: number }>}
   */
  async markAllAsRead(adminId, category) {
    const result = await adminNotificationRepository.markAllAsRead(adminId, category);
    await this._broadcastUnreadCount(adminId);
    return result;
  }

  /**
   * Send notifications to the admins as soon as they are saved, whichever process saved them:
   * in production the parent API creates most of them and only the admin API has the /admin namespace.
   * Change streams need a replica set: on a standalone MongoDB createNotification sends them instead.
   */
  startRealtimeBroadcast() {
    if (!supportsChangeStreams()) {
      logger.info('[AdminNotifications] No change streams on this MongoDB, notifications are sent directly');
      return;
    }
    this._openStream();
  }

  /**
   * Close the change stream (shutdown and tests)
   */
  async stopRealtimeBroadcast() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const stream = this.stream;
    this.stream = null;
    if (stream) await stream.close();
  }

  _openStream() {
    const stream = adminNotificationRepository.watchInserts();
    this.stream = stream;

    stream.on('change', ({ fullDocument }) => {
      void this._broadcastNew(fullDocument);
    });

    stream.on('error', (err) => {
      logger.error(`[AdminNotifications] Change stream failed: ${err.message}`);
      this.stream = null;
      stream.close().catch(() => {});
      // Admins reload the list when they reconnect; until the retry, notifications are sent directly
      this.retryTimer = setTimeout(() => this._openStream(), ADMIN_NOTIFICATION_STREAM_RETRY_MS);
      this.retryTimer.unref?.();
    });
  }

  async _broadcastNew(notification) {
    try {
      broadcastAdminNotification(AdminNotificationDTO.toResponse(notification));
      broadcastAdminUnreadCount(await adminNotificationRepository.countUnread());
    } catch (err) {
      logger.error(`[AdminNotifications] Broadcast failed: ${err.message}`);
    }
  }

  async _broadcastUnreadCount(adminId) {
    try {
      broadcastAdminUnreadCount(await adminNotificationRepository.countUnread(adminId));
    } catch (err) {
      logger.error(`[AdminNotifications] Unread count broadcast failed: ${err.message}`);
    }
  }
}

export default new AdminNotificationService();
