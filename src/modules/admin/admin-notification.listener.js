import logger from '../../shared/logger/index.js';
import adminNotificationRepository from './admin-notification.repository.js';
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_SEVERITY,
} from './admin-notification.model.js';
import { getAdminIO } from '../../config/socket.js';
import { onUserEvent, USER_EVENTS } from '../user/user.events.js';
import { onSubscriptionEvent, SUBSCRIPTION_EVENTS } from '../subscription/subscription.events.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';
import { onConnectionEvent, CONNECTION_EVENTS } from '../connection/connection.events.js';
import { onSafetyEvent, SAFETY_EVENTS } from '../safety/safety.events.js';
import { onSystemEvent, SYSTEM_EVENTS } from '../../shared/events/system.events.js';

/**
 * Broadcast notification and updated unread count to admins room
 * @param {Object} notification
 */
const broadcastToAdmins = async (notification) => {
  try {
    const adminIO = getAdminIO();
    if (!adminIO) return;

    // Send the new notification
    adminIO.to('admins').emit('admin:notification:new', {
      ...notification,
      isRead: false,
    });

    // Send updated unread counts
    // For a general room broadcast, unread counts without an adminId filter count items where readBy is empty
    const { total, byCategory } = await adminNotificationRepository.countUnread(null);
    adminIO.to('admins').emit('admin:notification:unread-count', {
      total,
      byCategory,
    });
  } catch (err) {
    logger.error(`[AdminNotificationListener] Socket broadcast failed: ${err.message}`);
  }
};

/**
 * Create and broadcast an admin notification safely
 * @param {Object} data
 */
const createAndBroadcast = async (data) => {
  try {
    const created = await adminNotificationRepository.create(data);
    const notificationObj = created.toObject ? created.toObject() : created;
    await broadcastToAdmins(notificationObj);
  } catch (err) {
    logger.error(`[AdminNotificationListener] Failed to create notification: ${err.message}`);
  }
};

let isRegistered = false;

/**
 * Register all domain event listeners for admin notifications
 */
export const registerAdminNotificationListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  // 1. Users Category
  onUserEvent(USER_EVENTS.USER_SIGNED_UP, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.USERS,
      type: 'new_signup',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Đăng ký tài khoản mới',
      message: `Phụ huynh ${payload.fullName || payload.email || 'mới'} vừa tạo tài khoản trên hệ thống.`,
      entityType: 'User',
      entityId: payload.userId,
    });
  });

  onUserEvent(USER_EVENTS.USER_STATUS_CHANGED, async (payload) => {
    const isUnlocked = Boolean(payload.isActive);
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.USERS,
      type: isUnlocked ? 'account_unlocked' : 'account_locked',
      severity: isUnlocked ? ADMIN_NOTIFICATION_SEVERITY.INFO : ADMIN_NOTIFICATION_SEVERITY.WARNING,
      title: isUnlocked ? 'Tài khoản được mở khoá' : 'Tài khoản đã bị khoá',
      message: `Tài khoản ${payload.email} đã được ${isUnlocked ? 'mở khoá' : 'khoá'}.`,
      entityType: 'User',
      entityId: payload.userId,
    });
  });

  // 2. Payments Category
  onSubscriptionEvent(SUBSCRIPTION_EVENTS.PAYMENT_SUCCEEDED, async (payload) => {
    const formattedAmount = payload.amount ? Number(payload.amount).toLocaleString('vi-VN') : '0';
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.PAYMENTS,
      type: 'payment_succeeded',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Thanh toán thành công',
      message: `Đơn hàng #${payload.orderCode || ''} (${formattedAmount} ₫) đã thanh toán thành công.`,
      entityType: 'Payment',
      entityId: payload.paymentId,
    });
  });

  onSubscriptionEvent(SUBSCRIPTION_EVENTS.PAYMENT_FAILED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.PAYMENTS,
      type: 'payment_failed',
      severity: ADMIN_NOTIFICATION_SEVERITY.WARNING,
      title: 'Thanh toán thất bại',
      message: `Giao dịch đơn hàng #${payload.orderCode || ''} đã thất bại hoặc bị huỷ.`,
      entityType: 'Payment',
      entityId: payload.paymentId,
    });
  });

  onSubscriptionEvent(SUBSCRIPTION_EVENTS.SUBSCRIPTION_CREATED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.PAYMENTS,
      type: 'new_subscription',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Thuê bao mới được kích hoạt',
      message: `Phụ huynh đã kích hoạt gói cước ${payload.planName || payload.planCode || ''}.`,
      entityType: 'Subscription',
      entityId: payload.subscriptionId,
    });
  });

  onSubscriptionEvent(SUBSCRIPTION_EVENTS.SUBSCRIPTION_EXPIRED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.PAYMENTS,
      type: 'subscription_expired',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Thuê bao đã hết hạn',
      message: `Gói ${payload.planName || payload.planCode || ''} của phụ huynh ${payload.parentName || ''} đã hết hạn.`,
      entityType: 'Subscription',
      entityId: payload.subscriptionId,
    });
  });

  // 3. Playdates Category
  onPlaydateEvent(PLAYDATE_EVENTS.CREATED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.PLAYDATES,
      type: 'created',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Buổi hẹn chơi mới được tạo',
      message: `Buổi hẹn "${payload.activity || 'Hẹn chơi'}" vừa được tạo bởi ${payload.hostName || 'phụ huynh'}.`,
      entityType: 'Playdate',
      entityId: payload.playdateId,
    });
  });

  onPlaydateEvent(PLAYDATE_EVENTS.CANCELLED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.PLAYDATES,
      type: 'cancelled',
      severity: payload.cancelledByAdmin ? ADMIN_NOTIFICATION_SEVERITY.WARNING : ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: payload.cancelledByAdmin ? 'Buổi hẹn bị huỷ bởi Quản trị viên' : 'Buổi hẹn chơi đã bị huỷ',
      message: `Buổi hẹn "${payload.activity || ''}" đã bị huỷ${payload.reason ? `: ${payload.reason}` : ''}.`,
      entityType: 'Playdate',
      entityId: payload.playdateId,
    });
  });

  // 4. Connections Category
  onConnectionEvent(CONNECTION_EVENTS.ACCEPTED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.CONNECTIONS,
      type: 'new_connection',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Kết nối mới được thiết lập',
      message: 'Hai phụ huynh vừa kết nối thành công với nhau.',
      entityType: 'Connection',
      entityId: payload.connectionId,
    });
  });

  onConnectionEvent(CONNECTION_EVENTS.REMOVED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.CONNECTIONS,
      type: 'connection_removed',
      severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
      title: 'Kết nối đã bị huỷ',
      message: 'Một kết nối giữa hai gia đình đã bị xoá.',
      entityType: 'Connection',
      entityId: payload.connectionId,
    });
  });

  // 5. Safety Category
  onSafetyEvent(SAFETY_EVENTS.REPORT_CREATED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.SAFETY,
      type: 'new_violation_report',
      severity: ADMIN_NOTIFICATION_SEVERITY.CRITICAL,
      title: 'Báo cáo vi phạm mới cần xử lý',
      message: `Báo cáo vi phạm mới: ${payload.reason || 'Nội dung hoặc hành vi không phù hợp'}.`,
      entityType: 'Report',
      entityId: payload.reportId,
    });
  });

  // 6. System Category
  onSystemEvent(SYSTEM_EVENTS.CRON_JOB_FAILED, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.SYSTEM,
      type: 'cron_job_failed',
      severity: ADMIN_NOTIFICATION_SEVERITY.CRITICAL,
      title: 'Lỗi tác vụ định kỳ hệ thống (Cron Job)',
      message: `Tác vụ "${payload.jobName || 'Hệ thống'}" gặp sự cố: ${payload.error || 'Lỗi không xác định'}.`,
      entityType: 'System',
      entityId: null,
    });
  });

  onSystemEvent(SYSTEM_EVENTS.PAYMENT_GATEWAY_ERROR, async (payload) => {
    await createAndBroadcast({
      category: ADMIN_NOTIFICATION_CATEGORIES.SYSTEM,
      type: 'payment_gateway_error',
      severity: ADMIN_NOTIFICATION_SEVERITY.CRITICAL,
      title: 'Lỗi cổng thanh toán PayOS',
      message: `Lỗi xử lý webhook PayOS: ${payload.error || 'Xác thực dữ liệu thất bại'}.`,
      entityType: 'Payment',
      entityId: null,
    });
  });

  logger.info('Admin notification listeners registered successfully');
};

export default registerAdminNotificationListeners;
