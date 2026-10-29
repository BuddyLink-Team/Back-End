import axios from 'axios';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:5001/api/v1/admin';

async function sendTestNotification() {
  try {
    console.log('1. Đang đăng nhập tài khoản Admin...');
    const loginRes = await axios.post(`${ADMIN_API_URL}/auth/login`, {
      email: 'admin@buddylink.vn',
      password: '123456',
    });

    const token = loginRes.data?.data?.tokens?.accessToken;
    if (!token) {
      throw new Error('Không lấy được access token từ phản hồi đăng nhập');
    }
    console.log('   Đăng nhập thành công!');

    const sampleNotifications = [
      {
        category: 'safety',
        type: 'test_safety_alert',
        severity: 'critical',
        title: 'CẢNH BÁO BÁO CÁO VI PHẠM KHẨN CẤP',
        message: 'Phát hiện nội dung có nguy cơ gây mất an toàn cho trẻ em tại phòng trò chuyện.',
      },
      {
        category: 'payments',
        type: 'test_payment',
        severity: 'info',
        title: 'Giao dịch thanh toán PayOS mới',
        message: 'Phụ huynh Hoàng Nam vừa nâng cấp gói Premium Năm (1.790.000 ₫).',
      },
      {
        category: 'users',
        type: 'test_signup',
        severity: 'info',
        title: 'Thành viên mới gia nhập',
        message: 'Phụ huynh Nguyễn Minh Khang vừa tạo tài khoản tại khu vực Quận 7.',
      },
      {
        category: 'playdates',
        type: 'test_playdate',
        severity: 'info',
        title: 'Buổi hẹn chơi sắp bắt đầu',
        message: 'Buổi hẹn "Đá bóng thiếu nhi" tại Sân cỏ Hoa Lư có 4 gia đình xác nhận tham gia.',
      },
    ];

    const randomIndex = Math.floor(Math.random() * sampleNotifications.length);
    const chosen = sampleNotifications[randomIndex];

    console.log(`2. Đang gửi thông báo Realtime [${chosen.category.toUpperCase()} - ${chosen.severity.toUpperCase()}]...`);
    const res = await axios.post(`${ADMIN_API_URL}/notifications/test`, chosen, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log('   Bắn thông báo Socket.io thành công!');
    console.log('   Tiêu đề:', res.data?.data?.title);
    console.log('   Nội dung:', res.data?.data?.message);
    console.log('\n👉 Hãy kiểm tra ngay trên tab trình duyệt Admin Dashboard: thông báo đã nhảy ra Realtime!');
  } catch (err) {
    console.error('Lỗi khi gửi thông báo test:', err.response?.data?.message || err.message);
  }
}

sendTestNotification();
