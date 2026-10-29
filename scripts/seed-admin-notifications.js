import mongoose from 'mongoose';
import connectDatabase from '../src/config/database.js';
import AdminNotification, {
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_SEVERITY,
} from '../src/modules/admin/admin-notification.model.js';

const SAMPLE_NOTIFICATIONS = [
  {
    category: ADMIN_NOTIFICATION_CATEGORIES.SAFETY,
    type: 'new_violation_report',
    severity: ADMIN_NOTIFICATION_SEVERITY.CRITICAL,
    title: 'Báo cáo vi phạm mới cần xử lý',
    message: 'Phụ huynh báo cáo phát hiện ngôn từ không phù hợp trong phòng trò chuyện nhóm.',
    entityType: 'report',
    entityId: new mongoose.Types.ObjectId(),
    readBy: [],
    createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago
  },
  {
    category: ADMIN_NOTIFICATION_CATEGORIES.PAYMENTS,
    type: 'payment_succeeded',
    severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
    title: 'Thanh toán gói Premium thành công',
    message: 'Đơn hàng #SUB-8921 (199.000 ₫) gói Premium Tháng đã thanh toán thành công qua PayOS.',
    entityType: 'payment',
    entityId: new mongoose.Types.ObjectId(),
    readBy: [],
    createdAt: new Date(Date.now() - 25 * 60 * 1000), // 25 mins ago
  },
  {
    category: ADMIN_NOTIFICATION_CATEGORIES.USERS,
    type: 'new_signup',
    severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
    title: 'Đăng ký tài khoản phụ huynh mới',
    message: 'Phụ huynh Trần Thuỳ Trang (trang.tran@gmail.com) vừa đăng ký tài khoản thành công.',
    entityType: 'user',
    entityId: new mongoose.Types.ObjectId(),
    readBy: [],
    createdAt: new Date(Date.now() - 1 * 3600 * 1000), // 1 hour ago
  },
  {
    category: ADMIN_NOTIFICATION_CATEGORIES.PLAYDATES,
    type: 'created',
    severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
    title: 'Buổi hẹn chơi mới được tạo',
    message: 'Buổi hẹn "Giao lưu tiếng Anh cuối tuần" tại Công viên Cầu Giấy vừa được tạo bởi phụ huynh Minh Tuấn.',
    entityType: 'playdate',
    entityId: new mongoose.Types.ObjectId(),
    readBy: [],
    createdAt: new Date(Date.now() - 2 * 3600 * 1000), // 2 hours ago
  },
  {
    category: ADMIN_NOTIFICATION_CATEGORIES.CONNECTIONS,
    type: 'new_connection',
    severity: ADMIN_NOTIFICATION_SEVERITY.INFO,
    title: 'Kết nối mới được thiết lập',
    message: 'Gia đình bé Bơ và bé Sữa vừa chấp nhận kết nối ghép đôi thành công.',
    entityType: 'connection',
    entityId: new mongoose.Types.ObjectId(),
    readBy: [],
    createdAt: new Date(Date.now() - 4 * 3600 * 1000), // 4 hours ago
  },
  {
    category: ADMIN_NOTIFICATION_CATEGORIES.SYSTEM,
    type: 'cron_job_failed',
    severity: ADMIN_NOTIFICATION_SEVERITY.WARNING,
    title: 'Cảnh báo đồng bộ dữ liệu hệ thống',
    message: 'Tác vụ đồng bộ địa điểm vui chơi định kỳ mất nhiều thời gian hơn ngưỡng quy định (42s).',
    entityType: 'system',
    entityId: null,
    readBy: [],
    createdAt: new Date(Date.now() - 6 * 3600 * 1000), // 6 hours ago
  },
];

async function seed() {
  try {
    await connectDatabase();
    console.log('Seeding sample admin notifications...');
    await AdminNotification.insertMany(SAMPLE_NOTIFICATIONS);
    const total = await AdminNotification.countDocuments();
    console.log(`Successfully seeded! Total notifications in DB: ${total}`);
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed admin notifications:', err.message);
    process.exit(1);
  }
}

seed();
