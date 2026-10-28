# Tài liệu Đặc tả Yêu cầu Phần mềm (SRS)
## Admin Subscription Plans & Revenue Management Screen

- **Dự án**: BuddyLink
- **Mã công việc (Ticket)**: BUD-34
- **Đường dẫn giao diện (Screen Route)**: `/admin/subscriptions`
- **Phiên bản**: 1.1
- **Ngày lập**: 25/10/2026
- **Trạng thái**: Bản đặc tả hoàn chỉnh sẵn sàng cho triển khai và nghiệm thu (Ready for Implementation)

---

## 1. Mục tiêu và phạm vi (Objectives & Scope)

### 1.1. Mục tiêu
Cung cấp phân hệ quản trị toàn diện dành cho Quản trị viên (Admin) của nền tảng BuddyLink nhằm:
1. Giám sát các chỉ số tài chính, doanh thu định kỳ, số lượng thuê bao hoạt động, tỷ lệ chuyển đổi (Conversion Rate) và tỷ lệ rời bỏ (Churn Rate).
2. Điều chỉnh giá bán và cấu hình hạn mức quyền lợi (Quota Limits) của các gói hội viên (Free, Premium tháng, Premium năm).
3. Theo dõi danh sách tài khoản thuê bao của toàn bộ phụ huynh và lịch sử duy trì gói.
4. Tra cứu, đối soát toàn bộ các giao dịch thanh toán PayOS chi tiết, hỗ trợ chăm sóc khách hàng và kiểm toán độc lập.

### 1.2. Phạm vi thực hiện (In-Scope)
- **TASK-BE (Backend)**:
  - Bổ sung các endpoints quản trị vào `src/modules/admin/admin.route.js`, chạy trên ứng dụng `admin-app.js` tại prefix `/api/v1/admin`.
  - Bảo vệ bắt buộc bằng Admin Auth Guard (`authenticate`, `authorizeRoles(USER_ROLES.ADMIN)` với token audience `aud: 'admin'`).
  - Tái sử dụng và mở rộng các repository từ module `src/modules/subscription`:
    - `SubscriptionPlanRepository`
    - `SubscriptionRepository`
    - `PaymentRepository`
  - Thực hiện chuẩn hóa Input qua middleware `validate()`, bắt lỗi nghiệp vụ với `AppError`, và ánh xạ dữ liệu đầu ra qua DTO.
  - Viết Integration Tests bổ sung vào `test/integration/admin-portal.test.js`.
- **TASK-FE (Frontend)**:
  - Xây dựng trang `src/modules/admin/pages/AdminSubscriptionManagementPage.jsx`.
  - Thay thế placeholder route `subscriptions` trong `src/routes/AdminRoutes.jsx`.
  - Triển khai 4 tab nghiệp vụ:
    1. **Tổng quan (Overview)**: KPI cards (Tổng doanh thu, Thuê bao Premium hoạt động, Conversion Rate, Churn Rate), biểu đồ doanh thu theo tháng (Recharts Bar/Area Chart), bộ lọc khoảng thời gian (`DateRangeFilter`).
    2. **Gói dịch vụ (Subscription Plans)**: Danh sách thẻ các gói, form cập nhật tên, giá, hạn mức quota (có switch bật/tắt "Không giới hạn" cho giá trị `-1`), trạng thái Active/Inactive. Hộp thoại xác nhận (`ConfirmDialog`) trước khi lưu thay đổi giá.
    3. **Thuê bao (Subscribers)**: Bảng dữ liệu (`DataTable`), tìm kiếm phụ huynh (tên/email), bộ lọc gói và trạng thái (`active` / `expired`), phân trang (`useServerTable`).
    4. **Giao dịch (Transactions)**: Bảng kiểm toán giao dịch (`DataTable`), tìm kiếm mã đơn / tên phụ huynh, chip trạng thái thanh toán (đầy đủ 6 trạng thái), lọc ngày, modal chi tiết giao dịch khi nhấp vào hàng.
  - Các hàm gọi API đặt trong `src/modules/admin/api/adminSubscriptionApi.js`.
  - Tuân thủ Stitch Design System: typography `Plus Jakarta Sans`, gam màu Soft Matcha Green `#7BAE7F`, card hairline border `#EDF2F0`, không sử dụng arbitrary Tailwind values.

### 1.3. Ngoài phạm vi (Out-of-Scope)
- Không tạo mới collection MongoDB; cấu trúc dữ liệu giữ nguyên: mỗi phụ huynh có 1 document `Subscription` duy nhất, lịch sử gói trích xuất từ các bản ghi `Payment` thành công (`planSnapshot` + `grantResult`).
- Không hỗ trợ Admin tạo gói cước mới tùy ý (mã gói `planCode` là enum cố định trong code: `free`, `premium_monthly`, `premium_yearly`).
- Không hoàn tiền (refund) tự động từ cổng PayOS qua màn hình này.
- Không xuất hóa đơn điện tử VAT trực tiếp từ PayOS.
- Không cho phép Admin hạ trạng thái thanh toán đã `success` về các trạng thái khác.

---

## 2. Quy tắc nghiệp vụ (Business Rules)

### BR-01: Quản trị gói cước (Subscription Plans Governance)
1. **Các gói cước hợp lệ**: Hệ thống hỗ trợ đúng 3 gói dịch vụ chuẩn theo enum `SUBSCRIPTION_PLAN_CODES`:
   - `free`: Gói miễn phí khởi tạo cho toàn bộ phụ huynh mới.
   - `premium_monthly`: Gói trả phí thời hạn 1 tháng lịch.
   - `premium_yearly`: Gói trả phí thời hạn 12 tháng lịch.
2. **Các trường chỉ đọc (Read-only Fields)**:
   - `planCode`: Mã định danh gói (enum cố định, logic cấp quyền phụ thuộc vào trường này).
   - `durationMonths`: Số tháng lịch được cộng khi thanh toán (0 với free, 1 với monthly, 12 với yearly).
   - `billingCycle`: Chu kỳ thanh toán (`none`, `monthly`, `yearly`).
   - `currency`: Đơn vị tiền tệ cố định là `VND`.
3. **Các trường cho phép cập nhật (Editable Fields)**:
   - `name`: Tên hiển thị của gói.
   - `price`: Đơn giá bán (VND).
   - `features`: Đối tượng chứa hạn mức quota các chức năng.
   - `isActive`: Trạng thái kích hoạt kinh doanh (boolean).
4. **Ràng buộc toàn vẹn gói**:
   - Gói `free` **bắt buộc** phải giữ `price = 0` và **không được phép hủy kích hoạt** (`isActive` luôn là `true`). Bất kỳ thao tác đổi giá hoặc tắt active gói `free` đều bị từ chối với mã lỗi `FREE_PLAN_IMMUTABLE`.
   - Các gói Premium (`premium_monthly`, `premium_yearly`) **bắt buộc** phải có `price > 0`.
5. **Tính bất biến của giao dịch trong quá khứ**:
   - Khi Admin đổi giá hoặc quota của gói, các bản ghi `Payment` đã phát sinh trước đó **hoàn toàn không bị ảnh hưởng**, vì mỗi `Payment` lưu trữ một bản sao độc lập (`planSnapshot`) tại thời điểm checkout.
   - Giá mới chỉ áp dụng cho các phiên tạo checkout phát sinh sau thời điểm cập nhật.

### BR-02: Quy ước và cấu hình hạn mức Quota (Features Quota Limits)
1. Các hạng mục quota cấu hình trong `features` bao gồm:
   - `childProfilesLimit`: Số lượng hồ sơ trẻ tối đa phụ huynh được tạo (giới hạn tuyệt đối).
   - `discoveryViewLimitPerDay`: Số lượt quẹt / xem hồ sơ tìm bạn tối đa mỗi ngày (reset lúc 00:00 UTC+7).
   - `connectionRequestsLimitPerMonth`: Số lượt gửi yêu cầu kết bạn tối đa trong tháng (reset lúc 00:00 ngày 1 hàng tháng UTC+7).
   - `playdatesLimitPerMonth`: Số lượt chủ trì tạo cuộc hẹn chơi tối đa trong tháng (reset lúc 00:00 ngày 1 hàng tháng UTC+7).
   - `playdateParticipationLimitPerMonth`: Số lượt tham gia cuộc hẹn chơi của người khác tối đa trong tháng.
   - `aiAssistantLimitPerMonth`: Số lượt tương tác trợ lý AI tối đa trong tháng.
2. **Quy ước giá trị hạn mức**:
   - Giá trị số nguyên `>= 0`: Hạn mức tối đa được phép trong kỳ.
   - Giá trị `-1`: Đại diện cho **Không giới hạn (Unlimited)**.
   - Trên giao diện Frontend, khi trường có giá trị `-1`, công tắc "Không giới hạn" được bật và ô nhập số bị vô hiệu hóa; khi tắt công tắc, giá trị chuyển về số nguyên dương mặc định.

### BR-03: Giám sát thuê bao phụ huynh (Subscriptions Monitoring)
1. **Liên kết dữ liệu (Data Joining)**:
   - Mỗi phụ huynh có đúng 1 bản ghi `Subscription` liên kết với collection `parents` thông qua `parentId`.
   - Bảng hiển thị thông tin phụ huynh gồm: Họ tên phụ huynh (`fullName`), Avatar, Email đăng nhập tài khoản (`User.email`).
2. **Trạng thái thuê bao (Status Evaluation)**:
   - `active`: Gói `free` hoặc gói Premium có `status = 'active'` và `endDate > now()`.
   - `expired`: Gói Premium đã quá hạn (`endDate <= now()`) hoặc subscription có `status = 'expired'`.
3. **Bộ lọc & Tìm kiếm**:
   - Hỗ trợ lọc theo `planCode` (`all`, `free`, `premium_monthly`, `premium_yearly`).
   - Hỗ trợ lọc theo `status` (`all`, `active`, `expired`).
   - Tìm kiếm (`search`) theo họ tên phụ huynh (`fullName`) hoặc email (`email`), không phân biệt hoa thường.
   - Phân trang chuẩn theo cấu hình `PAGINATION` hiện có của Backend (`DEFAULT_PAGE = 1`, `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 100`).

### BR-04: Kiểm toán giao dịch thanh toán (Payments Audit & Security)
1. **Trạng thái giao dịch (`status`)** - Đầy đủ 6 trạng thái:
   - `creating`: Đang khởi tạo đơn hàng và link PayOS.
   - `pending`: Đang chờ phụ huynh chuyển khoản / quét mã QR.
   - `success`: Thanh toán thành công và đã hoàn tất cấp quyền Premium.
   - `failed`: Giao dịch bị ngân hàng / cổng từ chối hoặc lỗi xử lý.
   - `cancelled`: Phụ huynh hủy giao dịch trên PayOS hoặc link bị hủy.
   - `expired`: Hết hạn thanh toán (mặc định sau 15 phút).
2. **Lọc thời gian giao dịch**:
   - Tham số `fromDate` và `toDate` thống nhất lọc theo thời gian tạo đơn `createdAt` của bản ghi Payment.
3. **Thời hạn hiệu lực (Effective Period)**:
   - Với các giao dịch `success`, hiển thị khoảng thời hạn quyền lợi được cấp tương ứng từ `grantResult.effectiveStartDate` đến `grantResult.effectiveEndDate` và số tháng được cộng `grantResult.monthsGranted`.
4. **Bảo mật dữ liệu (Data Stripping & Privacy)**:
   - Khi trả về chi tiết giao dịch `GET /payments/:id`, Backend **tuyệt đối không trả về** `checkoutUrl` và `qrCode` để bảo mật cổng thanh toán và tránh tình trạng thanh toán ngoài ý muốn.
   - `parentId` được hỗ trợ làm tham số query (`GET /payments?parentId=...`) để Drawer chi tiết phụ huynh tại màn hình `/admin/users` có thể tải lịch sử thanh toán của riêng phụ huynh đó.

### BR-05: Công thức & Thuật toán thống kê doanh thu (Revenue Metrics & Statistics)

1. **Tổng doanh thu (Total Revenue)**:
   - Chỉ tính các giao dịch có `status = 'success'` và có thời gian thanh toán `paidAt` nằm trong khoảng thời gian `[fromDate, toDate]`:
   $$\text{Total Revenue} = \sum \text{amount} \quad \text{với các đơn } status = \text{'success'} \text{ và } paidAt \in [\text{fromDate}, \text{toDate}]$$
   - *Lưu ý*: Doanh thu chỉ tính theo trường `paidAt` của Payment success (không fallback sang `createdAt`).

2. **Doanh thu theo tháng (Monthly Revenue Breakdown)**:
   - Gom nhóm (Group by) các đơn hàng `success` theo chuỗi tháng `YYYY-MM` của `paidAt`.
   - Kết quả trả về danh sách từng tháng gồm: nhãn tháng (ví dụ: `Tháng 05/2026`), tổng doanh thu, và số giao dịch thành công.

3. **Số lượng giao dịch thành công (Successful Transactions)**:
   $$\text{Successful Transactions} = \text{Count}(\text{Payments có } status = \text{'success'} \text{ và } paidAt \in [\text{fromDate}, \text{toDate}])$$

4. **Số phụ huynh trả phí (Paying Parents)**:
   $$\text{Paying Parents} = \text{Count}(\text{Distinct } parentId \text{ có ít nhất 1 Payment } status = \text{'success'})$$

5. **Số thuê bao Premium đang hoạt động hiện tại (Current Active Premium Subscribers)**:
   $$\text{Active Premium Subscribers} = \text{Count}(\text{Subscriptions có } planCode \in [\text{'premium\_monthly'}, \text{'premium\_yearly'}] \land status = \text{'active'} \land endDate > \text{now}())$$

6. **Tỷ lệ chuyển đổi (Conversion Rate)**:
   $$\text{Conversion Rate (\%)} = \left( \frac{\text{Số phụ huynh có ít nhất 1 Payment success}}{\text{Tổng số tài khoản phụ huynh}} \right) \times 100$$
   *(Nếu Tổng số phụ huynh = 0 thì Conversion Rate = 0%).*

7. **Tỷ lệ rời bỏ (Churn Rate)**:
   Giữ nguyên định nghĩa và công thức chuẩn theo Task Description:
   $$\text{Churn rate} = \frac{\text{parents whose last Premium period (Payment.grantResult.effectiveEndDate) ended within the range with no later success payment}}{\text{parents with an active Premium period at the start of the range}}$$
   
   - **Mẫu số (Denominator)**: Số phụ huynh có chu kỳ Premium đang có hiệu lực tại thời điểm bắt đầu khoảng thời gian (`fromDate`), tức có ít nhất một Payment thành công thỏa mãn `effectiveStartDate <= fromDate < effectiveEndDate`.
   - **Tử số (Numerator)**: Số phụ huynh có chu kỳ Premium cuối cùng (`effectiveEndDate` lớn nhất trong toàn bộ các Payment thành công của phụ huynh đó) kết thúc trong khoảng `[fromDate, toDate]`, và **không có** bất kỳ giao dịch Payment thành công nào sau đó.
   - *Xử lý gia hạn sớm*: Nếu phụ huynh đã thanh toán gia hạn trước ngày hết hạn (hoặc trong kỳ), đơn gia hạn đó đã cộng dồn thời hạn và tạo ra `effectiveEndDate` mới xa hơn. Khi đó, chu kỳ Premium cuối cùng của phụ huynh chưa kết thúc trong khoảng `[fromDate, toDate]`, nên phụ huynh này **không bị tính là rời bỏ**.
   - *(Nếu Mẫu số = 0 thì Churn Rate = 0%).*

---

## 3. Mô hình dữ liệu & Cấu trúc Database (Data Models)

Hệ thống tận dụng và tái sử dụng trực tiếp các Model Mongoose hiện hữu:

### 3.1. Collection `subscription_plans`
```javascript
{
  _id: ObjectId,
  planCode: String,        // 'free' | 'premium_monthly' | 'premium_yearly' (Unique, Read-only)
  name: String,            // Tên gói (Editable)
  price: Number,           // Đơn giá VND (Editable, Free = 0, Premium > 0)
  currency: String,        // 'VND' (Read-only)
  durationMonths: Number,  // 0 | 1 | 12 (Read-only)
  billingCycle: String,    // 'none' | 'monthly' | 'yearly' (Read-only)
  features: {              // Quota limits: -1 là không giới hạn (Editable)
    childProfilesLimit: Number,
    discoveryViewLimitPerDay: Number,
    connectionRequestsLimitPerMonth: Number,
    playdatesLimitPerMonth: Number,
    playdateParticipationLimitPerMonth: Number,
    aiAssistantLimitPerMonth: Number
  },
  isActive: Boolean,       // Trạng thái mở bán (Editable, Free luôn true)
  createdAt: Date,
  updatedAt: Date
}
```

### 3.2. Collection `subscriptions`
```javascript
{
  _id: ObjectId,
  parentId: ObjectId,      // Ref 'Parent' (Unique index)
  planCode: String,        // 'free' | 'premium_monthly' | 'premium_yearly'
  status: String,          // 'active' | 'expired'
  startDate: Date,
  endDate: Date,           // null đối với gói Free
  calendarAnchorAt: Date,  // Mốc giờ ngày bắt đầu chu kỳ
  purchasedMonths: Number, // Tổng số tháng đã cấp tích lũy
  lastPaymentId: ObjectId, // Ref 'Payment'
  createdAt: Date,
  updatedAt: Date
}
```

### 3.3. Collection `payments`
```javascript
{
  _id: ObjectId,
  parentId: ObjectId,      // Ref 'Parent' (Indexed)
  subscriptionId: ObjectId,// Ref 'Subscription'
  orderCode: Number,       // Mã số đơn PayOS duy nhất (Unique index)
  idempotencyKey: String,
  planSnapshot: {          // Snapshot bất biến tại thời điểm checkout
    planCode: String,
    name: String,
    price: Number,
    currency: String,
    durationMonths: Number
  },
  amount: Number,          // Số tiền thực thu (VND)
  currency: String,        // 'VND'
  paymentMethod: String,   // 'payos'
  status: String,          // 'creating' | 'pending' | 'success' | 'failed' | 'cancelled' | 'expired'
  paymentLinkId: String,
  checkoutUrl: String,     // Lưu nội bộ, không trả ra API admin detail
  qrCode: String,          // Lưu nội bộ, không trả ra API admin detail
  transactionId: String,   // Mã giao dịch từ ngân hàng / PayOS
  bankInfo: {
    bin: String,
    accountNumber: String,
    accountName: String,
    description: String
  },
  expiresAt: Date,
  paidAt: Date,            // Thời điểm thanh toán thành công (dùng tính doanh thu)
  fulfilledAt: Date,
  failureReason: String,
  grantResult: {           // Kết quả gia hạn được cấp từ đơn này
    effectiveStartDate: Date,
    effectiveEndDate: Date,
    monthsGranted: Number
  },
  createdAt: Date,         // Dùng lọc thời gian fromDate/toDate trong GET /payments
  updatedAt: Date
}
```

---

## 4. Đặc tả API Contract Backend (TASK-BE)

Tất cả các route dưới đây được gắn vào `src/modules/admin/admin.route.js` sau middleware xác thực Admin:
```javascript
router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));
```
Base path: `/api/v1/admin`

### 4.1. Plans Endpoints

#### 4.1.1. `GET /api/v1/admin/plans`
- **Mô tả**: Lấy danh sách toàn bộ 3 gói cước (`free`, `premium_monthly`, `premium_yearly`), bao gồm cả các gói đang tạm ngưng (`isActive: false`).
- **Headers**: `Authorization: Bearer <admin_token>`
- **Query**: Không có.
- **Phản hồi thành công (200 OK)**:
```json
{
  "success": true,
  "message": "Subscription plans retrieved successfully",
  "data": {
    "plans": [
      {
        "id": "671aa1...",
        "planCode": "free",
        "name": "Gói Miễn Phí (Free)",
        "price": 0,
        "currency": "VND",
        "durationMonths": 0,
        "billingCycle": "none",
        "features": {
          "childProfilesLimit": 1,
          "discoveryViewLimitPerDay": 5,
          "connectionRequestsLimitPerMonth": 5,
          "playdatesLimitPerMonth": 3,
          "playdateParticipationLimitPerMonth": 3,
          "aiAssistantLimitPerMonth": 5
        },
        "isActive": true,
        "isFree": true,
        "updatedAt": "2026-10-25T08:00:00.000Z"
      },
      {
        "id": "671aa2...",
        "planCode": "premium_monthly",
        "name": "Gói Cao Cấp 1 Tháng (Premium Monthly)",
        "price": 99000,
        "currency": "VND",
        "durationMonths": 1,
        "billingCycle": "monthly",
        "features": {
          "childProfilesLimit": -1,
          "discoveryViewLimitPerDay": -1,
          "connectionRequestsLimitPerMonth": -1,
          "playdatesLimitPerMonth": -1,
          "playdateParticipationLimitPerMonth": -1,
          "aiAssistantLimitPerMonth": -1
        },
        "isActive": true,
        "isFree": false,
        "updatedAt": "2026-10-25T08:00:00.000Z"
      },
      {
        "id": "671aa3...",
        "planCode": "premium_yearly",
        "name": "Gói Cao Cấp 1 Năm (Premium Yearly)",
        "price": 990000,
        "currency": "VND",
        "durationMonths": 12,
        "billingCycle": "yearly",
        "features": {
          "childProfilesLimit": -1,
          "discoveryViewLimitPerDay": -1,
          "connectionRequestsLimitPerMonth": -1,
          "playdatesLimitPerMonth": -1,
          "playdateParticipationLimitPerMonth": -1,
          "aiAssistantLimitPerMonth": -1
        },
        "isActive": true,
        "isFree": false,
        "updatedAt": "2026-10-25T08:00:00.000Z"
      }
    ]
  },
  "error": null
}
```

#### 4.1.2. `PATCH /api/v1/admin/plans/:id`
- **Mô tả**: Cập nhật thông tin cấu hình giá, tên, hạn mức quota và trạng thái mở bán của một gói.
- **Headers**: `Authorization: Bearer <admin_token>`
- **Params**: `id` (MongoDB ObjectId của SubscriptionPlan)
- **Request Body**:
```json
{
  "name": "Gói Cao Cấp 1 Tháng Ưu Đãi",
  "price": 89000,
  "features": {
    "childProfilesLimit": -1,
    "discoveryViewLimitPerDay": -1,
    "connectionRequestsLimitPerMonth": -1,
    "playdatesLimitPerMonth": -1,
    "playdateParticipationLimitPerMonth": -1,
    "aiAssistantLimitPerMonth": -1
  },
  "isActive": true
}
```
- **Validation Rules**:
  - `name`: Chuỗi không rỗng, tối đa 100 ký tự (optional).
  - `price`: Số nguyên `>= 0` (optional). Nếu gói là `free`, `price` bắt buộc phải là 0; nếu gói là `premium_*`, `price` bắt buộc `> 0`.
  - `features.*`: Số nguyên `>= -1`.
  - `isActive`: Boolean (optional). Với gói `free`, không cho phép chuyển thành `false`.
  - Nghiêm cấm nhận hoặc sửa đổi: `planCode`, `durationMonths`, `billingCycle`, `currency` (nếu gửi lên sẽ bị bỏ qua hoặc trả 400).
- **Mã lỗi đặc thù**:
  - `400 BAD_REQUEST`: Giá trị đầu vào không hợp lệ hoặc cố gắng thay đổi `price != 0` cho gói free.
  - `400 FREE_PLAN_IMMUTABLE`: Không thể vô hiệu hóa gói Free (`isActive: false`).
  - `404 PLAN_NOT_FOUND`: Không tìm thấy gói theo `id`.

---

### 4.2. Subscriptions Endpoints

#### 4.2.1. `GET /api/v1/admin/subscriptions`
- **Mô tả**: Danh sách thuê bao phân trang của toàn bộ phụ huynh trong hệ thống, kèm thông tin cá nhân.
- **Headers**: `Authorization: Bearer <admin_token>`
- **Query Params**:
  - `page`: Số trang (mặc định theo `PAGINATION.DEFAULT_PAGE = 1`).
  - `limit`: Số bản ghi mỗi trang (mặc định theo `PAGINATION.DEFAULT_LIMIT = 10`, tối đa `PAGINATION.MAX_LIMIT = 100`).
  - `planCode`: Lọc theo mã gói (`free`, `premium_monthly`, `premium_yearly`).
  - `status`: Lọc theo trạng thái (`active`, `expired`).
  - `search`: Từ khóa tìm kiếm theo tên phụ huynh hoặc email.
- **Phản hồi thành công (200 OK)**:
```json
{
  "success": true,
  "message": "Subscriptions retrieved successfully",
  "data": {
    "items": [
      {
        "id": "671bb1...",
        "parent": {
          "id": "671cc1...",
          "fullName": "Nguyễn Văn A",
          "avatarUrl": "https://res.cloudinary.com/.../avatar1.jpg",
          "email": "parent.a@example.com"
        },
        "planCode": "premium_monthly",
        "planName": "Gói Cao Cấp 1 Tháng",
        "status": "active",
        "startDate": "2026-10-01T15:00:00.000Z",
        "endDate": "2026-11-01T15:00:00.000Z",
        "purchasedMonths": 1,
        "createdAt": "2026-10-01T15:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 45,
      "totalPages": 5
    }
  },
  "error": null
}
```

---

### 4.3. Payments Endpoints

#### 4.3.1. `GET /api/v1/admin/transactions`
- **Mô tả**: Danh sách lịch sử giao dịch thanh toán PayOS có phân trang và bộ lọc chuyên sâu.
- **Headers**: `Authorization: Bearer <admin_token>`
- **Query Params**:
  - `page`: Số trang (mặc định theo `PAGINATION.DEFAULT_PAGE = 1`).
  - `limit`: Số bản ghi mỗi trang (mặc định theo `PAGINATION.DEFAULT_LIMIT = 10`, tối đa `PAGINATION.MAX_LIMIT = 100`).
  - `status`: `creating` | `pending` | `success` | `failed` | `cancelled` | `expired`.
  - `planCode`: `free` | `premium_monthly` | `premium_yearly`.
  - `parentId`: ObjectId của phụ huynh (hỗ trợ load lịch sử cho User Drawer).
  - `fromDate`: Định dạng ISO Date chuỗi bắt đầu lọc thời gian theo `createdAt`.
  - `toDate`: Định dạng ISO Date chuỗi kết thúc lọc thời gian theo `createdAt`.
  - `search`: Tìm kiếm theo mã đơn `orderCode` (dạng số) hoặc tên phụ huynh.
- **Phản hồi thành công (200 OK)**:
```json
{
  "success": true,
  "message": "Payments retrieved successfully",
  "data": {
    "items": [
      {
        "id": "671dd1...",
        "orderCode": 1729845123456,
        "parent": {
          "id": "671cc1...",
          "fullName": "Nguyễn Văn A",
          "avatarUrl": "https://res.cloudinary.com/.../avatar1.jpg",
          "email": "parent.a@example.com"
        },
        "planSnapshot": {
          "planCode": "premium_monthly",
          "name": "Gói Cao Cấp 1 Tháng",
          "price": 99000,
          "durationMonths": 1
        },
        "amount": 99000,
        "currency": "VND",
        "status": "success",
        "paymentMethod": "payos",
        "effectivePeriod": {
          "effectiveStartDate": "2026-10-01T15:00:00.000Z",
          "effectiveEndDate": "2026-11-01T15:00:00.000Z",
          "monthsGranted": 1
        },
        "paidAt": "2026-10-01T15:02:10.000Z",
        "createdAt": "2026-10-01T15:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 128,
      "totalPages": 13
    }
  },
  "error": null
}
```

#### 4.3.2. `GET /api/v1/admin/transactions/:id`
- **Mô tả**: Xem chi tiết đối soát chuyên sâu của một giao dịch thanh toán.
- **Headers**: `Authorization: Bearer <admin_token>`
- **Params**: `id` (ObjectId của payment).
- **Yêu cầu bảo mật quan trọng**: Backend loại bỏ `checkoutUrl` và `qrCode` ra khỏi response.
- **Phản hồi thành công (200 OK)**:
```json
{
  "success": true,
  "message": "Payment detail retrieved successfully",
  "data": {
    "id": "671dd1...",
    "orderCode": 1729845123456,
    "transactionId": "FT262989123489",
    "parent": {
      "id": "671cc1...",
      "fullName": "Nguyễn Văn A",
      "avatarUrl": "https://res.cloudinary.com/.../avatar1.jpg",
      "email": "parent.a@example.com"
    },
    "planSnapshot": {
      "planCode": "premium_monthly",
      "name": "Gói Cao Cấp 1 Tháng",
      "price": 99000,
      "currency": "VND",
      "durationMonths": 1
    },
    "amount": 99000,
    "currency": "VND",
    "status": "success",
    "paymentMethod": "payos",
    "bankInfo": {
      "bin": "970422",
      "accountNumber": "0381000123456",
      "accountName": "NGUYEN VAN A",
      "description": "BUDDYLINK 1729845123456"
    },
    "paidAt": "2026-10-01T15:02:10.000Z",
    "fulfilledAt": "2026-10-01T15:02:11.000Z",
    "failureReason": null,
    "grantResult": {
      "effectiveStartDate": "2026-10-01T15:00:00.000Z",
      "effectiveEndDate": "2026-11-01T15:00:00.000Z",
      "monthsGranted": 1
    },
    "createdAt": "2026-10-01T15:00:00.000Z",
    "updatedAt": "2026-10-01T15:02:11.000Z"
  },
  "error": null
}
```

---

### 4.4. Revenue Statistics Endpoint

#### 4.4.1. `GET /api/v1/admin/revenue/summary`
- **Mô tả**: Tính toán và trả về toàn bộ các chỉ số đo lường hiệu quả kinh doanh, doanh thu theo tháng, tỷ lệ chuyển đổi và tỷ lệ rời bỏ.
- **Headers**: `Authorization: Bearer <admin_token>`
- **Query Params**:
  - `fromDate`: (Optional) Ngày bắt đầu lọc (YYYY-MM-DD hoặc ISO). Mặc định là đầu năm hiện tại hoặc 6 tháng trước.
  - `toDate`: (Optional) Ngày kết thúc lọc. Mặc định là thời điểm hiện tại.
- **Phản hồi thành công (200 OK)**:
```json
{
  "success": true,
  "message": "Revenue summary statistics retrieved successfully",
  "data": {
    "overview": {
      "totalRevenue": 24850000,
      "successfulTransactions": 142,
      "payingParentsCount": 115,
      "activePremiumSubscribers": 86,
      "conversionRate": 9.2,
      "churnRate": 3.4
    },
    "monthlyRevenue": [
      {
        "month": "2026-05",
        "label": "T05/2026",
        "revenue": 3465000,
        "transactionCount": 21
      },
      {
        "month": "2026-06",
        "label": "T06/2026",
        "revenue": 4950000,
        "transactionCount": 30
      },
      {
        "month": "2026-07",
        "label": "T07/2026",
        "revenue": 5445000,
        "transactionCount": 33
      },
      {
        "month": "2026-08",
        "label": "T08/2026",
        "revenue": 5940000,
        "transactionCount": 36
      },
      {
        "month": "2026-09",
        "label": "T09/2026",
        "revenue": 5050000,
        "transactionCount": 22
      }
    ],
    "filter": {
      "fromDate": "2026-05-01T00:00:00.000Z",
      "toDate": "2026-10-25T16:00:00.000Z"
    }
  },
  "error": null
}
```

---

## 5. Đặc tả Giao diện & Kiến trúc Frontend (TASK-FE)

### 5.1. Cấu trúc thư mục module Frontend
```text
Front-End/src/modules/admin/
├── api/
│   └── adminSubscriptionApi.js       # Gọi các endpoint /api/v1/admin/plans, subscriptions, payments, revenue
├── components/
│   ├── subscription/
│   │   ├── RevenueKpiCards.jsx       # 4 KPI cards: Doanh thu, Thuê bao, Conversion, Churn
│   │   ├── MonthlyRevenueChart.jsx   # Biểu đồ Recharts BarChart / AreaChart
│   │   ├── PlanEditCard.jsx          # Thẻ gói dịch vụ với form chỉnh sửa quota & giá
│   │   ├── PriceChangeConfirmModal.jsx # Modal cảnh báo khi đổi giá bán
│   │   ├── SubscribersTable.jsx      # Bảng danh sách thuê bao phụ huynh
│   │   ├── TransactionsTable.jsx     # Bảng danh sách giao dịch
│   │   └── PaymentDetailModal.jsx    # Modal chi tiết giao dịch kiểm toán
├── hooks/
│   ├── useAdminPlans.js              # State & mutations cho danh mục gói cước
│   ├── useAdminRevenueSummary.js     # State & API fetching cho thống kê doanh thu (fetch theo filter, không tự động polling định kỳ)
├── pages/
│   └── AdminSubscriptionManagementPage.jsx # Trang chính gồm 4 tabs
```

### 5.2. Tích hợp định tuyến (Routing Integration)
Cập nhật file `Front-End/src/routes/AdminRoutes.jsx`:
Thay thế placeholder tại path `subscriptions`:
```jsx
// Thay thế placeholder cũ:
// <Route path="subscriptions" element={<AdminPlaceholder ... />} />
// Bằng trang thực tế:
<Route path="subscriptions" element={<AdminSubscriptionManagementPage />} />
```

### 5.3. Bố cục 4 Tab chi tiết

#### Tab 1: Tổng quan (Overview)
- **Thanh công cụ phía trên**:
  - Tiêu đề phụ: "Tổng quan doanh thu và hiệu quả chuyển đổi hội viên".
  - Component `DateRangeFilter` (chọn từ ngày - đến ngày).
- **Hàng KPI Cards (4 cards)**:
  1. *Tổng doanh thu*: Giá trị VND (format `Intl.NumberFormat('vi-VN')`), kèm số lượng giao dịch thành công. Icon `CircleDollarSign` (Matcha green).
  2. *Thuê bao Premium hoạt động*: Số lượng phụ huynh đang có Premium active. Icon `Crown` (Butter yellow).
  3. *Tỷ lệ chuyển đổi (Conversion Rate)*: Hiển thị %, tooltip giải thích = (Số phụ huynh trả phí / Tổng phụ huynh) × 100%. Icon `TrendingUp`.
  4. *Tỷ lệ rời bỏ (Churn Rate)*: Hiển thị %, tooltip giải thích = (Số phụ huynh có kỳ Premium cuối cùng kết thúc trong khoảng lọc mà không có đơn thành công sau đó / Số phụ huynh có Premium lúc bắt đầu khoảng lọc) × 100%. Icon `UserMinus`.
- **Biểu đồ doanh thu hàng tháng (Monthly Revenue Chart)**:
  - Sử dụng component `BarChart` từ `src/components/charts/BarChart` hoặc Recharts container.
  - Cột màu Matcha Green `#7BAE7F`, hover tooltip hiển thị số tiền chính xác và số giao dịch.
  - Trục X: Các tháng (`T05/26`, `T06/26`,...).
  - Trục Y: Doanh thu triệu đồng (VND).

#### Tab 2: Gói dịch vụ (Subscription Plans)
- Lưới 3 cột trên Desktop (1 cột trên Mobile), mỗi cột là 1 `Card` cho từng gói:
  - **Header Card**: Tên gói, Badge gói (`Gói Miễn Phí` màu Slate, `Gói Tháng` màu Matcha, `Gói Năm` màu Butter/Gold), công tắc `Switch` "Đang kích hoạt kinh doanh" (bị disabled đối với gói Free).
  - **Đơn giá**: Input số tiền VND. Disabled đối với gói Free.
  - **Thông tin cố định (Disabled / Read-only)**:
    - Mã gói (`planCode`).
    - Thời hạn (`durationMonths` tháng).
    - Chu kỳ (`billingCycle`).
    - Tiền tệ (`currency`).
  - **Hạn mức tính năng (Quota Settings)**:
    - Hồ sơ bé tối đa (`childProfilesLimit`).
    - Lượt quẹt / ngày (`discoveryViewLimitPerDay`).
    - Lời mời kết nối / tháng (`connectionRequestsLimitPerMonth`).
    - Cuộc hẹn tạo / tháng (`playdatesLimitPerMonth`).
    - Cuộc hẹn tham gia / tháng (`playdateParticipationLimitPerMonth`).
    - Yêu cầu AI / tháng (`aiAssistantLimitPerMonth`).
    - *Mỗi hạng mục Quota*: Gồm Input số nguyên và Switch "Không giới hạn". Khi bật Switch, tự động điền `-1` và khóa input.
  - **Nút Lưu cấu hình**:
    - Khi người dùng thay đổi `price` so với giá gốc, nhấn nút "Lưu thay đổi" sẽ kích hoạt `ConfirmDialog` với thông điệp:
      *"Bạn có chắc chắn muốn thay đổi giá gói từ [Giá cũ] thành [Giá mới]? Thay đổi này sẽ ảnh hưởng đến tất cả các giao dịch mua mới trong tương lai. Các giao dịch trong quá khứ không bị ảnh hưởng."*

#### Tab 3: Thuê bao (Subscribers)
- Quản lý danh sách phụ huynh sở hữu subscription thông qua hook `useServerTable`:
  - `AdminListToolbar`:
    - `SearchBar`: Tìm kiếm tên phụ huynh hoặc email.
    - `FilterChips`: Lọc theo mã gói (`Tất cả`, `Free`, `Gói tháng`, `Gói năm`).
    - `FilterChips`: Lọc trạng thái (`Tất cả`, `Đang hoạt động`, `Đã hết hạn`).
  - `DataTable`:
    - Cột 1: **Phụ huynh**: Avatar, họ tên, email.
    - Cột 2: **Gói hiện tại**: Badge phân màu theo gói.
    - Cột 3: **Trạng thái**: `StatusChip` (`active` - Xanh lá, `expired` - Xám).
    - Cột 4: **Ngày bắt đầu**: Định dạng `DD/MM/YYYY HH:mm`.
    - Cột 5: **Ngày hết hạn**: Định dạng `DD/MM/YYYY HH:mm` (hoặc "-" nếu là gói Free).
    - Cột 6: **Tổng tháng đã mua**: Số tháng tích lũy (`purchasedMonths`).
  - `Pagination`: Điều hướng trang linh hoạt theo hằng số phân trang hệ thống.

#### Tab 4: Giao dịch (Transactions)
- Giám sát toàn bộ giao dịch thanh toán:
  - `AdminListToolbar`:
    - `SearchBar`: Tìm kiếm mã đơn hàng PayOS (`orderCode`) hoặc tên phụ huynh.
    - `FilterChips`: Lọc theo đủ 6 trạng thái thanh toán: `Tất cả`, `creating` (Khởi tạo), `pending` (Chờ thanh toán), `success` (Thành công), `failed` (Thất bại), `cancelled` (Đã hủy), `expired` (Hết hạn).
    - `DateRangeFilter`: Lọc giao dịch phát sinh từ ngày - đến ngày theo `createdAt`.
  - `DataTable`:
    - Cột 1: **Mã đơn hàng**: Font monospace đậm, có nút copy nhanh.
    - Cột 2: **Phụ huynh**: Họ tên và email.
    - Cột 3: **Gói cước**: Tên gói tại thời điểm mua (`planSnapshot.name`).
    - Cột 4: **Số tiền**: Định dạng VND (ví dụ: `99.000 ₫`).
    - Cột 5: **Trạng thái**: `StatusChip` tương ứng (6 trạng thái: `creating`, `pending`, `success`, `failed`, `cancelled`, `expired`).
    - Cột 6: **Thời gian**: Ngày tạo đơn (`createdAt`) và ngày thanh toán thành công (`paidAt`).
    - Cột 7: **Thời hạn hiệu lực**: Hiển thị khoảng thời gian cấp quyền (`grantResult` với các đơn success).
    - Cột 8: **Hành động**: Nút xem chi tiết (Icon `Eye`).
  - **Transaction Detail Modal**:
    - Hiển thị đầy đủ thông tin kỹ thuật phục vụ kiểm toán: Mã giao dịch PayOS (`transactionId`), thông tin ngân hàng thanh toán (`bankInfo`: tên chủ tài khoản, số tài khoản, mã chuẩn chi ngân hàng BIN), lý do lỗi (`failureReason` nếu có), snapshot gói cước, timestamps.
    - **Loại bỏ hoàn toàn**: Link thanh toán và mã QR.

---

## 6. Kiểm thử và Tiêu chí nghiệm thu (Acceptance Criteria)

### 6.1. Tiêu chí nghiệm thu chức năng (Acceptance Criteria - AC)

| Mã AC | Điều kiện kiểm tra & Kết quả mong đợi |
| :--- | :--- |
| **AC-01** | **Xác thực Admin Guard**: Người dùng chưa đăng nhập hoặc có role `PARENT` truy cập bất kỳ endpoint `/api/v1/admin/plans`, `/subscriptions`, `/payments`, `/revenue/summary` đều nhận mã lỗi `401 Unauthorized` hoặc `403 Forbidden`. |
| **AC-02** | **Danh sách gói cước (GET /plans)**: Trả về đầy đủ 3 gói dịch vụ (`free`, `premium_monthly`, `premium_yearly`), đầy đủ các trường quota trong `features`, kể cả khi có gói có `isActive: false`. |
| **AC-03** | **Bảo vệ tính bất biến gói Free**: Thao tác `PATCH /plans/:id` với gói Free có `price != 0` hoặc `isActive: false` lập tức bị từ chối với HTTP 400 và thông báo lỗi rõ ràng (`FREE_PLAN_IMMUTABLE`). |
| **AC-04** | **Cập nhật gói Premium & Kiểm tra Read-only**: `PATCH /plans/:id` thành công cho phép cập nhật tên gói, giá bán (`> 0`), các hạn mức quota (hỗ trợ giá trị `-1`) và trạng thái `isActive`. Các trường `planCode`, `durationMonths`, `billingCycle`, `currency` không bị thay đổi (read-only) và được kiểm thử tính bất biến. |
| **AC-05** | **Không ảnh hưởng đơn cũ**: Thay đổi giá của `premium_monthly` không làm thay đổi `amount` hoặc `planSnapshot` của các bản ghi `payments` đã tạo trước đó. |
| **AC-06** | **Tra cứu thuê bao (GET /subscriptions)**: Phân trang chính xác theo `PAGINATION`, dữ liệu phụ huynh được join chính xác từ collection `parents` và `users`. Lọc theo `planCode` và `status` hoạt động đúng. |
| **AC-07** | **Tìm kiếm thuê bao**: Nhập từ khóa tên phụ huynh hoặc email tìm kiếm trả về danh sách thuê bao khớp chính xác mà không phân biệt chữ hoa / thường. |
| **AC-08** | **Tra cứu giao dịch (GET /payments)**: Phân trang, sắp xếp mới nhất lên đầu, lọc theo trạng thái (đủ 6 trạng thái) và khoảng ngày `createdAt` (`fromDate`, `toDate`) trả về dữ liệu chuẩn xác. |
| **AC-09** | **Tra cứu giao dịch theo parentId**: Truyền `parentId` trả về danh sách lịch sử thanh toán của riêng phụ huynh đó, phục vụ User Drawer tại màn hình quản lý người dùng. |
| **AC-10** | **Bảo mật chi tiết giao dịch (GET /payments/:id)**: Trả về chi tiết đối soát gồm `transactionId`, `bankInfo`, `grantResult`, nhưng **không chứa** `checkoutUrl` và `qrCode`. |
| **AC-11** | **Thống kê tổng doanh thu**: Tổng doanh thu trong `GET /revenue/summary` bằng tổng trường `amount` của các đơn `status = 'success'` có `paidAt` trong khoảng thời gian chọn (không fallback sang `createdAt`). |
| **AC-12** | **Thống kê Conversion Rate**: Tính toán chuẩn theo công thức (Số phụ huynh có ít nhất 1 đơn Payment success / Tổng số phụ huynh) × 100%. Nếu tổng số phụ huynh = 0, trả về 0%. |
| **AC-13** | **Thống kê Churn Rate**: Tính toán chuẩn xác theo công thức Churn Rate: Số phụ huynh có kỳ Premium cuối cùng (`effectiveEndDate`) kết thúc trong khoảng lọc và không có đơn Payment success nào sau đó ÷ Số phụ huynh có chu kỳ Premium đang hoạt động tại thời điểm bắt đầu khoảng lọc (`fromDate`). Phụ huynh gia hạn sớm không bị tính là churn. Xử lý mẫu số = 0 an toàn không gây lỗi NaN. |
| **AC-14** | **Giao diện FE 4 Tabs**: Trang `/admin/subscriptions` thay thế hoàn toàn placeholder, hiển thị 4 tab đầy đủ tính năng theo Description. |
| **AC-15** | **Cảnh báo thay đổi giá trên FE**: Nhấn lưu thay đổi giá trên thẻ gói cước mở `ConfirmDialog` xác nhận trước khi gửi request PATCH lên server. |
| **AC-16** | **Tuân thủ chuẩn Thiết kế**: Giao diện đạt chuẩn Stitch: font `Plus Jakarta Sans`, bo góc `rounded-xl` / `rounded-2xl`, màu sắc Matcha Green và Neutral, không dùng arbitrary bracket Tailwind values. |

### 6.2. Kịch bản kiểm thử tích hợp (Integration Tests)
Bổ sung các test suite vào `Back-End/test/integration/admin-portal.test.js`:
1. `GET /api/v1/admin/plans`: Kiểm tra quyền admin và trả về đúng 3 gói cước khởi tạo.
2. `PATCH /api/v1/admin/plans/:id`:
   - Kiểm tra chặn sửa giá và vô hiệu hóa gói Free.
   - Cập nhật giá và quota gói Premium thành công.
   - Xác nhận các trường `planCode`, `durationMonths`, `billingCycle`, `currency` không bị sửa đổi.
3. `GET /api/v1/admin/subscriptions`: Kiểm tra danh sách thuê bao có phân trang và join thông tin parent.
4. `GET /api/v1/admin/transactions`: Kiểm tra lọc theo status (6 trạng thái), planCode, parentId và date range `createdAt`.
5. `GET /api/v1/admin/transactions/:id`: Kiểm tra chi tiết và xác nhận không có `checkoutUrl`, `qrCode`.
6. `GET /api/v1/admin/revenue/summary`: Kiểm tra tính toán tổng doanh thu theo `paidAt`, doanh thu tháng, conversion rate và churn rate (bao gồm trường hợp gia hạn sớm).

---

## 7. Định nghĩa Hoàn thành (Definition of Done - DoD)

1. [ ] **Mã nguồn Backend**:
   - Thêm các endpoint quản trị vào `modules/admin/admin.route.js` phía sau admin auth guard (`/api/v1/admin`).
   - Tái sử dụng các repository trong `modules/subscription`.
   - Chuẩn hóa validation thông qua `validate()` và mapping qua DTO theo conventions của dự án.
   - Thêm integration tests vào `test/integration/admin-portal.test.js` và chạy pass 100%.
   - Chạy `npm run lint` đạt yêu cầu.
2. [ ] **Mã nguồn Frontend**:
   - Xây dựng `modules/admin/pages/AdminSubscriptionManagementPage.jsx` gồm đầy đủ 4 tab: Tổng quan, Gói dịch vụ, Thuê bao, Giao dịch.
   - Thay thế subscriptions placeholder trong `AdminRoutes.jsx`.
   - Các API calls đặt trong `modules/admin/api/adminSubscriptionApi.js`.
   - Giao diện tuân thủ Stitch admin design và không có lỗi lint/build.
3. [ ] **Tài liệu & Quy trình Git**:
   - Tài liệu SRS được lưu tại `Back-End/docs/SRS_ADMIN_SUBSCRIPTION_REVENUE.md` và `Front-End/docs/SRS_ADMIN_SUBSCRIPTION_REVENUE.md`.
   - Commit code tuân thủ Conventional Commits theo quy định Git của dự án (`feat(admin): ...`).
