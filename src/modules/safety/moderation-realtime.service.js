import env from '../../config/env.js';
import { getIO } from '../../config/socket.js';
import logger from '../../shared/logger/index.js';
import { supportsChangeStreams } from '../../shared/helpers/transaction.helper.js';
import { broadcastAccountLocked, broadcastMessageDeleted } from '../../sockets/moderation.broadcast.js';
import chatService from '../chat/chat.service.js';
import userService from '../user/user.service.js';

const STREAM_RETRY_MS = 5000;

const toLockNotice = ({ banReason, suspensionUntil }) => {
  if (suspensionUntil) {
    const endsAt = new Date(suspensionUntil).toLocaleString('vi-VN', { timeZone: env.APP_TIMEZONE });
    return { reason: `Tài khoản của bạn bị tạm đình chỉ đến ${endsAt}.`, suspensionUntil };
  }
  return {
    reason: banReason ? 'Tài khoản của bạn đã bị khóa vĩnh viễn.' : 'Tài khoản của bạn đã bị Quản trị viên khóa.',
    suspensionUntil: null,
  };
};

/**
 * Sanctions reach the parents' open connections right away.
 * Admins act from the admin API while the parent sockets live in the parent API, a separate process in
 * production: there the parent API follows the database with change streams. Without change streams
 * (standalone MongoDB, one process locally) the moderation code sends them directly.
 */
class ModerationRealtimeService {
  constructor() {
    this.streams = [];
    this.retryTimer = null;
  }

  /**
   * Start following the database. Only the parent API calls it: it is the one with the parent sockets.
   */
  startRealtimeBroadcast() {
    if (!supportsChangeStreams()) {
      logger.info('[ModerationRealtime] No change streams on this MongoDB, sanctions are sent directly');
      return;
    }
    this._openStreams();
  }

  /**
   * Close the change streams (shutdown and tests)
   */
  async stopRealtimeBroadcast() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this._closeStreams();
  }

  /**
   * @param {{ _id: ObjectId, banReason?: string|null, suspensionUntil?: Date|null }} user - As it is after the lock
   */
  notifyAccountLocked(user) {
    if (this.streams.length === 0) this._sendAccountLocked(user);
  }

  /**
   * @param {{ _id: ObjectId, conversationId: ObjectId }} message
   */
  async notifyMessageDeleted(message) {
    if (this.streams.length === 0) await this._sendMessageDeleted(message);
  }

  _openStreams() {
    const accounts = userService.watchLockedAccounts();
    const messages = chatService.watchDeletedMessages();
    this.streams = [accounts, messages];

    accounts.on('change', ({ fullDocument }) => {
      if (fullDocument) this._sendAccountLocked(fullDocument);
    });
    messages.on('change', ({ fullDocument }) => {
      if (fullDocument) void this._sendMessageDeleted(fullDocument);
    });
    this.streams.forEach((stream) => stream.on('error', (err) => this._handleStreamError(err)));
  }

  async _closeStreams() {
    const streams = this.streams;
    this.streams = [];
    await Promise.all(streams.map((stream) => stream.close().catch(() => {})));
  }

  _handleStreamError(err) {
    logger.error(`[ModerationRealtime] Change stream failed: ${err.message}`);
    // Several streams can fail together: one retry is enough
    if (this.retryTimer) return;
    void this._closeStreams();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._openStreams();
    }, STREAM_RETRY_MS);
    this.retryTimer.unref?.();
  }

  _sendAccountLocked(user) {
    broadcastAccountLocked(getIO(), user._id.toString(), toLockNotice(user));
  }

  async _sendMessageDeleted(message) {
    try {
      broadcastMessageDeleted(getIO(), await chatService.getDeletedMessageNotice(message));
    } catch (err) {
      logger.error(`[ModerationRealtime] Message deletion broadcast failed: ${err.message}`);
    }
  }
}

export const moderationRealtimeService = new ModerationRealtimeService();
export default moderationRealtimeService;
