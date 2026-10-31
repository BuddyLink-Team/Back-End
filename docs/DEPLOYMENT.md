# BuddyLink Deployment Guide

Hướng dẫn deploy BuddyLink lên **Render** (Back-End) và **Vercel** (Front-End), trong đó trang quản trị (admin) chạy tách riêng khỏi app phụ huynh.

---

## 1. Tổng quan

Hệ thống gồm 4 phần, mỗi phần là một service riêng:

| Phần | Nền tảng | Repo | Lệnh | URL ví dụ |
|---|---|---|---|---|
| API phụ huynh | Render Web Service | Back-End | `npm start` | `https://buddylink-api.onrender.com/api/v1` |
| API admin | Render Web Service | Back-End | `npm run start:admin` | `https://buddylink-admin-api.onrender.com/api/v1/admin` |
| Web phụ huynh | Vercel Project | Front-End | `npm run build` → `dist` | `https://buddylink.vercel.app` |
| Web admin | Vercel Project | Front-End | `npm run build:admin` → `dist-admin` | `https://buddylink-admin.vercel.app` |

```text
Web phụ huynh (Vercel) ──► API phụ huynh (Render) ──┐
                           + Socket.io, cron jobs    ├──► MongoDB Atlas
Web admin (Vercel) ──────► API admin (Render) ──────┘
```

- Ở local, admin chạy trên port riêng: API `5001`, web `5174`. Render chỉ mở **một port cho mỗi service**, nên trên production admin phải là **service riêng**.
- Token đăng nhập gắn với app đã cấp ra nó (`aud`): token phụ huynh bị API admin từ chối và ngược lại. Tài khoản admin không đăng nhập được ở web phụ huynh.
- Cron job và phần seed dữ liệu **chỉ chạy ở API phụ huynh**. API admin kết nối MongoDB, phục vụ `/api/v1/admin` và Socket.io namespace `/admin`.
- Thông báo realtime của admin, thông báo in-app của phụ huynh, và chế tài từ màn kiểm duyệt (ngắt kết nối tài khoản bị khóa, gỡ tin nhắn), đi qua MongoDB change stream nên cần replica set (Atlas đã có sẵn). Web admin tự lấy địa chỉ socket từ `VITE_API_URL`, không cần thêm biến môi trường.
- Khi cập nhật tính năng realtime của admin, deploy API admin trước rồi mới deploy web admin.

**Thứ tự deploy:** chuẩn bị (mục 2) → 2 service Render (mục 3, 4) → 2 project Vercel (mục 5, 6) → quay lại điền URL thật (mục 7) → dịch vụ bên ngoài (mục 8) → kiểm tra (mục 9).

---

## 2. Chuẩn bị

- **MongoDB Atlas** → *Network Access* → thêm `0.0.0.0/0`. Gói free của Render không có IP cố định nên phải mở cho mọi IP. Nên dùng user DB riêng cho production với mật khẩu mạnh.
- **JWT secret**: tạo 4 chuỗi ngẫu nhiên, gồm 2 cho API phụ huynh và 2 cho API admin. Hai API không đọc token của nhau, nên dùng secret khác nhau sẽ an toàn hơn.
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- **Firebase service account** (dùng để xác thực SĐT): chuyển file `firebase-service-account.json` thành **một dòng JSON** để dán vào biến `FIREBASE_SERVICE_ACCOUNT`. Không commit file này.
  ```bash
  node -e "console.log(JSON.stringify(require('./src/config/firebase-service-account.json')))"
  ```

---

## 3. Render: API phụ huynh

*New* → *Web Service* → chọn repo **Back-End**.

| Mục | Giá trị |
|---|---|
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/v1` |

**Environment** (lúc đầu chưa có URL Vercel thì điền tạm, sửa lại ở mục 7):

| Biến | Giá trị |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `CLIENT_URL` | URL web phụ huynh, ví dụ `https://buddylink.vercel.app` (không có `/` ở cuối) |
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` |
| `MONGODB_URI` | connection string Atlas |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | 2 secret của API phụ huynh |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | `15m`, `7d` |
| `AI_PROVIDER`, `GEMINI_API_KEY` | `gemini`, key Gemini |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash`, `gemini-3.5-flash-lite` (chạy `npm run ai:check` trên server để kiểm tra key và tên model) |
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | key PayOS |
| `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` | `<CLIENT_URL>/payment/success`, `<CLIENT_URL>/payment/cancel` |
| `PAYMENT_MODE` | `live` |
| `GOOGLE_CLIENT_ID` | OAuth client ID (giống `VITE_GOOGLE_CLIENT_ID` ở FE) |
| `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | thông tin Cloudinary |
| `EMAIL_FROM`, `BREVO_API_KEY` | gửi mail qua Brevo HTTP API (xem lưu ý bên dưới) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | chỉ dùng khi không có Brevo |
| `FIREBASE_SERVICE_ACCOUNT` | JSON một dòng ở mục 2 |
| `OVERPASS_ENABLED`, `PLACES_AUTO_SYNC`, `PLACES_ADDRESS_LOOKUP` | `true`, `true`, `true` |

> ⚠️ **Không đặt `ADMIN_PORT`** ở service này. Biến đó chỉ dùng ở local để chạy admin chung process.
>
> Nếu gửi mail bị timeout, nhiều khả năng host đang chặn port SMTP. Khi đó dùng `BREVO_API_KEY`, và `EMAIL_FROM` phải là sender đã được xác minh trong Brevo.

Deploy xong, mở `https://<api-phụ-huynh>.onrender.com/api/v1`. Nếu thấy `BuddyLink API v1 is active` là chạy được.

---

## 4. Render: API admin

*New* → *Web Service* → chọn **cùng repo Back-End**.

| Mục | Giá trị |
|---|---|
| Runtime | Node |
| Build Command | `npm ci` |
| Start Command | `npm run start:admin` |
| Health Check Path | `/api/v1/admin` |

**Environment:**

| Biến | Giá trị |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `1` |
| `ADMIN_CLIENT_URL` | URL web admin, ví dụ `https://buddylink-admin.vercel.app` |
| `MONGODB_URI` | **giống** API phụ huynh |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | 2 secret **riêng** của admin |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | `15m`, `7d` (có thể ngắn hơn cho admin) |
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` |
| `STORAGE_*` | như API phụ huynh (admin đổi avatar qua `/user/me/avatar`) |

- Service này nghe trên biến `PORT` do Render cấp, **không cần** đặt `ADMIN_PORT`.
- Khi thêm tính năng admin dùng dịch vụ khác (gửi mail, PayOS, …), nhớ thêm env tương ứng vào service này.

Deploy xong, mở `https://<api-admin>.onrender.com/api/v1/admin`. Nếu thấy `BuddyLink Admin API v1 is active` là chạy được.

> **Gói free của Render:** service sẽ ngủ sau 15 phút không có request, và request đầu tiên mất khoảng 30–60 giây để đánh thức. Hai service dùng chung quota giờ chạy miễn phí của workspace.

---

## 5. Vercel: Web phụ huynh

*Add New* → *Project* → import repo **Front-End**.

| Mục | Giá trị |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version (Settings → General) | `22.x` |

**Environment Variables:**

| Biến | Giá trị |
|---|---|
| `VITE_API_URL` | `https://<api-phụ-huynh>.onrender.com/api/v1` |
| `VITE_SOCKET_URL` | `https://<api-phụ-huynh>.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | OAuth client ID |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | cấu hình Firebase web |

- **Không** đặt `VITE_APP_TARGET` và `VITE_USE_MOCK` ở project này.
- File `vercel.json` trong repo đã chuyển mọi đường dẫn về `index.html`, nên F5 ở các trang con như `/discovery` không bị 404.

---

## 6. Vercel: Web admin

*Add New* → *Project* → import **cùng repo Front-End** và đặt tên khác, ví dụ `buddylink-admin`.

| Mục | Giá trị |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build:admin` |
| Output Directory | `dist-admin` |
| Node.js Version | `22.x` |

**Environment Variables:**

| Biến | Giá trị |
|---|---|
| `VITE_APP_TARGET` | `admin` |
| `VITE_API_URL` | `https://<api-admin>.onrender.com/api/v1/admin` |

- `.env.admin` không được commit, nên **bắt buộc** khai báo 2 biến trên trong dashboard Vercel. Nếu thiếu `VITE_APP_TARGET=admin`, project này sẽ build ra web phụ huynh.
- Có thể bật thêm *Settings → Deployment Protection* (Vercel Authentication hoặc Password, tùy gói) để có thêm một lớp bảo vệ trước trang đăng nhập admin.

> Biến `VITE_*` được gắn vào code **lúc build**. Sau khi sửa env trên Vercel phải **Redeploy** thì mới có hiệu lực.

---

## 7. Điền lại URL thật

Khi đã có URL Vercel, quay lại Render để sửa env. Render sẽ tự deploy lại sau khi lưu.

| Service | Biến | Giá trị |
|---|---|---|
| API phụ huynh | `CLIENT_URL` | URL web phụ huynh |
| API phụ huynh | `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL` | `<URL web phụ huynh>/payment/success`, `/payment/cancel` |
| API admin | `ADMIN_CLIENT_URL` | URL web admin |

CORS so sánh URL **chính xác**: phải đúng `https://`, không có `/` ở cuối, và đúng domain chính của project (không phải URL preview của từng lần deploy).

---

## 8. Dịch vụ bên ngoài

| Dịch vụ | Việc cần làm |
|---|---|
| **Google Cloud Console** → OAuth Client | Thêm URL web phụ huynh vào *Authorized JavaScript origins* |
| **Firebase** → Authentication → Settings | Thêm domain web phụ huynh vào *Authorized domains* |
| **PayOS** → Webhook | `https://<api-phụ-huynh>.onrender.com/api/v1/subscriptions/webhook`. Mở URL API trước để đánh thức service rồi mới lưu webhook (xem `BACKEND_SETUP.md`) |
| **Tài khoản admin** | Tạo user `role: "admin"` trực tiếp trong MongoDB, vì không có màn đăng ký cho admin |

---

## 9. Kiểm tra sau khi deploy

- [ ] `GET <api-phụ-huynh>/api/v1` → 200
- [ ] `GET <api-admin>/api/v1/admin` → 200
- [ ] Web phụ huynh: đăng ký, đăng nhập, F5 vẫn giữ phiên, chat realtime chạy được
- [ ] Web admin: đăng nhập bằng tài khoản admin → vào `/admin/dashboard`
- [ ] Đăng nhập tài khoản admin ở web phụ huynh → bị chặn ("vui lòng đăng nhập tại trang quản trị")
- [ ] Đăng nhập tài khoản phụ huynh ở web admin → bị từ chối (403)
- [ ] Thanh toán PayOS quay về đúng `/payment/success` của web phụ huynh

---

## 10. Lỗi thường gặp

| Triệu chứng | Nguyên nhân / Cách xử lý |
|---|---|
| Trình duyệt báo lỗi CORS | `CLIENT_URL` / `ADMIN_CLIENT_URL` sai (thừa `/` cuối, sai domain, đang dùng URL preview) |
| Request đầu tiên rất chậm hoặc timeout | Service Render đang ngủ (gói free), chờ khoảng 30–60 giây |
| Web admin hiện trang phụ huynh | Thiếu `VITE_APP_TARGET=admin`, hoặc chưa Redeploy sau khi thêm env |
| Web admin gọi nhầm API phụ huynh | `VITE_API_URL` của project admin phải kết thúc bằng `/api/v1/admin` |
| Thông báo admin không hiện realtime | Xem log API admin có `[AdminNotifications] No change streams` hoặc `Change stream failed` không, và kiểm tra `ADMIN_CLIENT_URL`. Danh sách vẫn đúng sau khi tải lại trang |
| F5 trang con bị 404 trên Vercel | Thiếu `vercel.json` ở thư mục gốc repo Front-End |
| Không gửi được email (timeout) | Host chặn port SMTP → dùng `BREVO_API_KEY` |
| Service không kết nối được MongoDB | Atlas chưa mở *Network Access* `0.0.0.0/0`, hoặc `MONGODB_URI` sai |
| Cron job (hết hạn gói, streak) chạy 2 lần | `npm start` đang chạy ở cả 2 service. Service admin phải dùng `npm run start:admin` |
