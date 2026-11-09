import env from '../../config/env.js';
import userService from '../user/user.service.js';
import chatService from '../chat/chat.service.js';
import playdateService from '../playdate/playdate.service.js';
import authService from '../auth/auth.service.js';
import parentService from '../parent/parent.service.js';
import notificationService from '../notification/notification.service.js';
import moderationRealtimeService from './moderation-realtime.service.js';
import { emitUserEvent, USER_EVENTS } from '../user/user.events.js';
import { NOTIFICATION_TYPES } from '../notification/notification.constants.js';
import { PLAYDATE_STATUS } from '../playdate/playdate.constants.js';
import {
  REPORT_ACTION_TYPES,
  REPORT_CATEGORY_NOTICES,
  REPORT_STATUS,
  REPORT_TARGET_TYPES,
} from './safety.constants.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/app-error.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const formatNoticeDate = (date) =>
  date.toLocaleString('vi-VN', { timeZone: env.APP_TIMEZONE });

/**
 * Unified executor for safety report sanctions.
 * Shared between Admin manual enforcement and Sentinel AI automated enforcement.
 */
class SanctionExecutorService {
  /**
   * Helper to build action object for report.actions
   * @private
   */
  _buildActionDoc(type, actor, {
    durationDays = null,
    reason = '',
    note = '',
    isPolicyOverride = false,
    overrideReason = '',
    policyClause = '',
    propagatedFrom = null,
    isProvisional = false,
  } = {}) {
    const isSystem = actor?.actorType === 'system';
    return {
      type,
      params: {
        durationDays: durationDays !== null ? parseInt(durationDays, 10) : null,
        reason: reason || '',
      },
      performedBy: isSystem ? null : (actor?.id || null),
      actorType: isSystem ? 'system' : 'admin',
      propagatedFrom: propagatedFrom || null,
      isProvisional: Boolean(isProvisional),
      performedAt: new Date(),
      note: note || '',
      isPolicyOverride: Boolean(isPolicyOverride),
      overrideReason: overrideReason || '',
      policyClause: policyClause || '',
    };
  }

  /**
   * Whether the playdate of a report can still be cancelled: upcoming and its day not over.
   * A playdate already held (a no-show), completed or cancelled makes CANCEL_PLAYDATE not applicable.
   * @param {Object} report
   * @returns {Promise<boolean>}
   */
  async isPlaydateCancellable(report) {
    if (!report.targetPlaydateId) return false;
    const playdate = await playdateService.getPlaydateById(report.targetPlaydateId).catch(() => null);
    if (!playdate || playdate.status !== PLAYDATE_STATUS.UPCOMING) return false;
    return new Date(playdate.scheduledDate).getTime() + DAY_MS > Date.now();
  }

  /**
   * Check every sanction before running any of them, so a report is never left half-sanctioned
   * (e.g. a warning sent, then the report handed back to the admin).
   * - executable: can run
   * - notApplicable: nothing to do for this target (not a failure), e.g. cancelling a playdate already held
   * - blockers: the sanction cannot run at all (e.g. reported account missing) -> run nothing
   * @param {{ report: Object, targetUser: Object|null, actions: Array<{ type: string, durationDays?: number }> }} param0
   * @returns {Promise<{ executable: Array, notApplicable: Array<{ type: string, reason: string }>, blockers: Array<{ type: string, code: string }> }>}
   */
  async planSanctions({ report, targetUser, actions = [] }) {
    const executable = [];
    const notApplicable = [];
    const blockers = [];

    for (const action of actions) {
      if (action.type === REPORT_ACTION_TYPES.DELETE_MESSAGE) {
        if (report.targetType !== REPORT_TARGET_TYPES.MESSAGE || !report.targetMessageId) {
          notApplicable.push({ type: action.type, reason: 'TARGET_MISMATCH' });
        } else {
          executable.push(action);
        }
      } else if (action.type === REPORT_ACTION_TYPES.CANCEL_PLAYDATE) {
        if (report.targetType !== REPORT_TARGET_TYPES.PLAYDATE || !report.targetPlaydateId) {
          notApplicable.push({ type: action.type, reason: 'TARGET_MISMATCH' });
        } else if (!(await this.isPlaydateCancellable(report))) {
          notApplicable.push({ type: action.type, reason: 'PLAYDATE_NOT_OPEN' });
        } else {
          executable.push(action);
        }
      } else if (!targetUser) {
        blockers.push({ type: action.type, code: 'TARGET_USER_NOT_FOUND' });
      } else {
        executable.push(action);
      }
    }

    return { executable, notApplicable, blockers };
  }

  /**
   * Post-action handler when an account is locked/suspended/banned
   */
  async afterAccountLocked(lockedUser, targetUser) {
    if (!targetUser?._id) return;
    try {
      await authService.revokeAllUserRefreshTokens(targetUser._id);
    } catch (err) {
      logger.warn(`[SanctionExecutor] Revoke tokens failed: ${err.message}`);
    }

    try {
      moderationRealtimeService.notifyAccountLocked(lockedUser);
    } catch (err) {
      logger.warn(`[SanctionExecutor] Realtime notifyAccountLocked failed: ${err.message}`);
    }

    try {
      void emitUserEvent(USER_EVENTS.USER_STATUS_CHANGED, {
        userId: targetUser._id,
        email: targetUser.email,
        isActive: false,
      });
    } catch (err) {
      logger.warn(`[SanctionExecutor] Emit USER_STATUS_CHANGED failed: ${err.message}`);
    }
  }

  /**
   * Dispatch system notification
   * @private
   */
  async sendReportNotification(notification) {
    try {
      await notificationService.createNotification({
        type: NOTIFICATION_TYPES.SYSTEM,
        ...notification,
      });
    } catch (error) {
      logger.error(`[SanctionExecutor] Notification failed: ${error.message}`);
    }
  }

  /**
   * Notify reporter when report status updates
   */
  async notifyReporter(report, status) {
    try {
      const reporterParent = await parentService.getParentById(report.reporterId).catch(() => null);
      if (!reporterParent?.userId) return;
      await this.sendReportNotification({
        recipientId: reporterParent.userId,
        title: 'Cập nhật báo cáo vi phạm',
        body:
          status === REPORT_STATUS.RESOLVED
            ? 'Báo cáo của bạn đã được xử lý theo Quy chuẩn Cộng đồng BuddyLink. Cảm ơn bạn đã chung tay bảo vệ an toàn cho các bé.'
            : 'Báo cáo của bạn đã được xem xét và lưu hồ sơ theo dõi.',
        data: { reportId: report._id },
      });
    } catch (err) {
      logger.warn(`[SanctionExecutor] Notify reporter failed: ${err.message}`);
    }
  }

  /**
   * Apply WARN sanction
   */
  async warn({ report, targetUser, actor, params = {} }) {
    if (!targetUser) {
      throw new AppError('Target user required for warning', 404, 'TARGET_USER_NOT_FOUND');
    }

    await userService.addStrike(targetUser._id);

    await this.sendReportNotification({
      recipientId: targetUser._id,
      title: 'Cảnh cáo vi phạm an toàn',
      body: `Bạn nhận được 1 cảnh cáo do vi phạm quy chuẩn cộng đồng: ${
        REPORT_CATEGORY_NOTICES[report.category] || 'vi phạm an toàn'
      }. Vui lòng tuân thủ quy tắc để giữ an toàn cho cộng đồng.`,
      data: { reportId: report._id },
    });

    const isSystem = actor?.actorType === 'system';
    const note = params.note || (isSystem
      ? `Sentinel AI: Tự động ghi nhận một lần vi phạm theo khung quy chuẩn`
      : 'Đã gửi cảnh cáo vi phạm quy chuẩn cộng đồng');

    return this._buildActionDoc(REPORT_ACTION_TYPES.WARN, actor, {
      ...params,
      note,
      reason: params.reason || 'Cảnh cáo vi phạm quy chuẩn cộng đồng',
    });
  }

  /**
   * Apply DELETE_MESSAGE sanction
   */
  async deleteMessage({ report, targetUser = null, actor, params = {} }) {
    if (!report.targetMessageId) {
      throw new AppError('Target message ID is required', 400, 'TARGET_NOT_FOUND');
    }

    const { message, alreadyDeleted } = await chatService.adminDeleteMessage(report.targetMessageId);

    if (message && !alreadyDeleted) {
      moderationRealtimeService.notifyMessageDeleted(message);
    }

    if (targetUser?._id) {
      await this.sendReportNotification({
        recipientId: targetUser._id,
        title: 'Tin nhắn đã bị gỡ bỏ',
        body: `Một tin nhắn của bạn đã bị gỡ bỏ do vi phạm quy chuẩn cộng đồng: ${
          REPORT_CATEGORY_NOTICES[report.category] || 'nội dung vi phạm'
        }.`,
        data: { reportId: report._id },
      });
    }

    const isSystem = actor?.actorType === 'system';
    const note = params.note || (isSystem
      ? 'Sentinel AI: Tự động gỡ bỏ tin nhắn vi phạm theo khung quy chuẩn'
      : 'Gỡ bỏ tin nhắn vi phạm');

    return this._buildActionDoc(REPORT_ACTION_TYPES.DELETE_MESSAGE, actor, {
      ...params,
      note,
      reason: params.reason || 'Gỡ bỏ tin nhắn vi phạm',
    });
  }

  /**
   * Apply CANCEL_PLAYDATE sanction
   */
  async cancelPlaydate({ report, actor, params = {} }) {
    if (!report.targetPlaydateId) {
      throw new AppError('Target playdate ID is required', 400, 'TARGET_NOT_FOUND');
    }

    const isSystem = actor?.actorType === 'system';
    const reason = params.reason || (isSystem
      ? 'Sentinel AI tự động hủy do vi phạm an toàn'
      : 'Bị hủy bởi ban quản trị do vi phạm báo cáo an toàn');

    await playdateService.cancelPlaydateByAdmin(report.targetPlaydateId, reason);

    const note = params.note || (isSystem
      ? 'Sentinel AI: Tự động hủy buổi hẹn theo khung quy chuẩn'
      : `Đã hủy buổi hẹn: ${reason}`);

    return this._buildActionDoc(REPORT_ACTION_TYPES.CANCEL_PLAYDATE, actor, {
      ...params,
      note,
      reason,
    });
  }

  /**
   * Apply SUSPEND sanction
   */
  async suspend({ report, targetUser, actor, params = {} }) {
    if (!targetUser) {
      throw new AppError('Target user required for suspension', 404, 'TARGET_USER_NOT_FOUND');
    }

    const days = Math.max(1, parseInt(params.durationDays, 10) || 3);
    const suspensionUntil = new Date(Date.now() + days * DAY_MS);

    let updated = null;
    if (targetUser.isActive !== false) {
      updated = await userService.suspendAccount(targetUser._id, suspensionUntil);
      await this.afterAccountLocked(updated || { _id: targetUser._id, suspensionUntil }, targetUser);

      await this.sendReportNotification({
        recipientId: targetUser._id,
        title: 'Tài khoản bị tạm đình chỉ',
        body: `Tài khoản của bạn bị tạm đình chỉ ${days} ngày, đến ${formatNoticeDate(
          suspensionUntil
        )}, do vi phạm quy chuẩn cộng đồng: ${
          REPORT_CATEGORY_NOTICES[report.category] || 'vi phạm an toàn'
        }.`,
        data: { reportId: report._id },
      });
    }

    const isSystem = actor?.actorType === 'system';
    const note = params.note || (isSystem
      ? `Sentinel AI: Tự động tạm đình chỉ ${days} ngày theo khung quy chuẩn`
      : `Tạm đình chỉ tài khoản ${days} ngày`);

    return this._buildActionDoc(REPORT_ACTION_TYPES.SUSPEND, actor, {
      ...params,
      durationDays: days,
      note,
      reason: params.reason || `Tạm đình chỉ ${days} ngày`,
    });
  }

  /**
   * Apply BAN sanction
   */
  async ban({ report, targetUser, actor, params = {} }) {
    if (!targetUser) {
      throw new AppError('Target user required for ban', 404, 'TARGET_USER_NOT_FOUND');
    }

    const isSystem = actor?.actorType === 'system';
    const banReason = params.reason || (isSystem
      ? 'Sentinel AI phát hiện vi phạm nghiêm trọng'
      : (params.note || 'Vi phạm nghiêm trọng quy chuẩn an toàn'));

    const updated = await userService.banAccount(targetUser._id, banReason);
    await this.afterAccountLocked(updated || { _id: targetUser._id }, targetUser);

    await this.sendReportNotification({
      recipientId: targetUser._id,
      title: 'Tài khoản đã bị cấm vĩnh viễn',
      body: `Tài khoản của bạn đã bị cấm vĩnh viễn do vi phạm nghiêm trọng quy chuẩn cộng đồng: ${
        REPORT_CATEGORY_NOTICES[report.category] || 'vi phạm an toàn'
      }.`,
      data: { reportId: report._id },
    });

    const note = params.note || (isSystem
      ? 'Sentinel AI: Cấm tài khoản vĩnh viễn theo khung quy chuẩn'
      : `Đã cấm tài khoản vĩnh viễn: ${banReason}`);

    return this._buildActionDoc(REPORT_ACTION_TYPES.BAN, actor, {
      ...params,
      note,
      reason: banReason,
    });
  }
}

export const sanctionExecutorService = new SanctionExecutorService();
export default sanctionExecutorService;

