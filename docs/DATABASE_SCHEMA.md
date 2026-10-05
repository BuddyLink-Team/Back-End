# BuddyLink Database Schema Design (MongoDB & Mongoose)

> **Dự án:** BuddyLink - AI-Powered Child Playmate Matching and Playdate Planning Platform
> **Cơ sở dữ liệu:** MongoDB (NoSQL Document Store)
> **Thư viện Object Modeling:** Mongoose ODM (Node.js)
> **Căn cứ thiết kế:** Toàn bộ chức năng, quy tắc nghiệp vụ và ràng buộc trong `PROJECT_OVERVIEW.md` cùng các yêu cầu chuẩn hóa kiến trúc.

---

## 1. Kiến trúc tổng quan & Danh sách Collections

Hệ thống cơ sở dữ liệu BuddyLink được tổ chức theo chuẩn phân tách rõ ràng:

- `users`: Chứa các trường định danh và tài khoản chung của cả **Parent** và **Admin**.
- `parents`: Collection riêng biệt lưu trữ thông tin nghiệp vụ phụ huynh, khu vực địa lý, **preferences**, cấu hình quyền riêng tư, xác thực và chuỗi streak.
- `auth_tokens`: Collection quản lý mã OTP và token xác thực dùng 1 lần (Phone OTP, Password Reset, Email Verification) tự hủy theo TTL Index.
- `refresh_tokens`: Collection quản lý phiên đăng nhập và cấp lại access token an toàn.
- Bỏ `activityCategory` và `endTime` trong `playdates`, đồng thời bỏ `newEndTime` trong `reschedule_requests` để tối giản và linh hoạt theo lịch thực tế của gia đình.
- Sơ đồ quan hệ thực thể (ERD) được phân tách chi tiết theo 7 Module nghiệp vụ độc lập bằng cú pháp **Mermaid ERD**, dễ dàng theo dõi và export hình ảnh.
- Script khởi tạo toàn bộ 23 Collections, Indexes và Skeleton Documents nạp sẵn vào MongoDB được lưu độc lập tại file [`scripts/init-mongo.js`](scripts/init-mongo.js).

### Bảng phân mục 23 Collections:

| STT | Collection              | Mô tả & Mục tiêu nghiệp vụ                                              | Phân hệ tương ứng trong`PROJECT_OVERVIEW.md`          |
| :-: | :---------------------- | :---------------------------------------------------------------------------- | :----------------------------------------------------------- |
|  1  | `users`               | Tài khoản định danh chung cho Parent và Admin                            | Mục 2 (Roles), 3.1 (Authentication), 15.1 (Admin User Mgmt) |
|  2  | `parents`             | Hồ sơ chi tiết của phụ huynh, preferences, privacy, streak               | Mục 3.2 (Parent Profile), 4.2 (Preferences), 10.1, 12.2, 13 |
|  3  | `auth_tokens`         | OTP điện thoại, token đặt lại mật khẩu, xác thực email dùng 1 lần | Mục 3.1 (Password Recovery), 13 (Phone Verification)        |
|  4  | `refresh_tokens`      | Quản lý phiên đăng nhập và cấp lại access token                      | Mục 3.1 (Authentication & Session Management)               |
|  5  | `children`            | Hồ sơ thông tin của trẻ em (Child Profile)                               | Mục 3.3 (Child Profile), 4.2 (Smart Matching)               |
|  6  | `swipes`              | Lịch sử tương tác thẻ khám phá (Like / Pass) của phụ huynh          | Mục 4.1 (Discovery & Swipe)                                 |
|  7  | `connections`         | Quan hệ kết nối giữa các phụ huynh (Request, Accepted, Declined)        | Mục 4.3 (Connection)                                        |
|  8  | `conversations`       | Phiên trò chuyện Direct 1-1 hoặc Group Playdate Chat                      | Mục 5.1 (Direct Chat), 5.2 (Playdate Chat)                  |
|  9  | `messages`            | Tin nhắn chi tiết (text, image, emoji, trạng thái đã đọc)             | Mục 5 (Communication)                                       |
| 10 | `playdates`           | Sự kiện gặp gỡ của các bé (không có activityCategory, endTime)       | Mục 6 (Playdate: 6.1, 6.2, 6.3)                             |
| 11 | `reschedule_requests` | Yêu cầu đề xuất đổi lịch Playdate (không có newEndTime)             | Mục 6.2 (Reschedule Request Workflow)                       |
| 12 | `ratings_feedbacks`   | Đánh giá sao và phản hồi chất lượng Playdate sau khi hoàn thành    | Mục 11 (Rating & Feedback)                                  |
| 13 | `ai_chat_sessions`    | Phiên hội thoại với AI Family Assistant và lịch sử tool calls          | Mục 8 (AI Playdate Assistant Agent)                         |
| 14 | `badges`              | Danh mục định nghĩa huy hiệu thành tích                                | Mục 10.2 (Badge Definition)                                 |
| 15 | `user_badges`         | Huy hiệu mà người dùng đã mở khóa được                            | Mục 10.2 (Unlocked Badges)                                  |
| 16 | `notifications`       | Thông báo hệ thống, tin nhắn, lời mời, huy hiệu                       | Mục 5.3 (Notification)                                      |
| 17 | `subscription_plans`  | Các gói cước dịch vụ (Free, Premium Monthly/Yearly)                     | Mục 14 (Premium Subscription), 15.5 (Admin Subscription)    |
| 18 | `subscriptions`       | Hợp đồng / gói đăng ký của phụ huynh                                 | Mục 14.2 (Subscription Management)                          |
| 19 | `payments`            | Lịch sử giao dịch thanh toán Premium                                      | Mục 14.2 (Payment History), 15.6 (Revenue Analytics)        |
| 20 | `usage_quotas`        | Kiểm soát giới hạn hạn mức Free vs Premium theo ngày/tháng            | Mục 14.1 (Feature Quota Limiting)                           |
| 21 | `reports`             | Báo cáo vi phạm an toàn, người dùng, tin nhắn                         | Mục 12.1 (Safety), 15.4 (Admin Safety)                      |
| 22 | `blocks`              | Danh sách phụ huynh bị chặn                                               | Mục 4.3 & 12.1 (Block User)                                 |
| 23 | `places_cache`        | Cache thông tin địa điểm vui chơi từ Google Places API                 | Mục 7.2 (Nearby Places & Activity)                          |

---
## 2. Mermaid Entity Relationship Diagrams (Phân tách theo từng Module)

Để sơ đồ không bị rối rắm và tiện theo dõi, hệ thống quan hệ thực thể (ERD) của 23 Collections được **phân tách thành 7 Module nghiệp vụ độc lập**. Bạn có thể sao chép riêng từng khối mã Mermaid để xem trên [mermaid.live](https://mermaid.live) hoặc xem trực tiếp qua Markdown Preview trong IDE.

---

### 2.1 Sơ đồ Kiến trúc Tổng quan Liên kết giữa các Phân hệ (High-Level Architecture Map)

```mermaid
flowchart TD
    subgraph M1["Module 1: Auth & Family Profiles"]
        U["users"] --- P["parents"]
        U --- AT["auth_tokens"]
        U --- RT["refresh_tokens"]
        P --- C["children"]
    end

    subgraph M2["Module 2: Discovery & Matching"]
        P -.-> SW["swipes"]
        C -.-> SW
        P -.-> CN["connections"]
    end

    subgraph M3["Module 3: Playdates & Places"]
        P -.-> PD["playdates"]
        C -.-> PD
        PD --- RR["reschedule_requests"]
        PD --- RF["ratings_feedbacks"]
        PC["places_cache"]
    end

    subgraph M4["Module 4: Chat & AI Assistant"]
        PD -.-> CV["conversations"]
        P -.-> CV
        CV --- MS["messages"]
        U -.-> NT["notifications"]
        P -.-> AI["ai_chat_sessions"]
    end

    subgraph M5["Module 5: Gamification"]
        P -.-> UB["user_badges"]
        BG["badges"] --- UB
    end

    subgraph M6["Module 6: Premium & Subscriptions"]
        SP["subscription_plans"] --- SB["subscriptions"]
        P -.-> SB
        SB --- PM["payments"]
        P -.-> UQ["usage_quotas"]
    end

    subgraph M7["Module 7: Safety & Moderation"]
        P -.-> BL["blocks"]
        P -.-> RP["reports"]
        U -.-> RP
        MS -.-> RP
        PD -.-> RP
    end
```

---

### 2.2 Module 1: Xác thực, Tài khoản & Hồ sơ Gia đình (Auth, Users, Parents & Children)

> **Collections:** `users`, `parents`, `children`, `auth_tokens`, `refresh_tokens`  
> **Nghiệp vụ:** Quản lý tài khoản đăng nhập (Local/Google OAuth), hồ sơ phụ huynh, hồ sơ các bé, OTP và phiên đăng nhập.

```mermaid
erDiagram
    USERS ||--o| PARENTS : "1:1 profile (userId)"
    USERS ||--o{ AUTH_TOKENS : "1:N otp/token (userId)"
    USERS ||--o{ REFRESH_TOKENS : "1:N session (userId)"
    PARENTS ||--o{ CHILDREN : "1:N children (parentId)"

    USERS {
        ObjectId _id PK
        string email UK "Indexed, unique"
        string phone "Indexed, sparse"
        string passwordHash "Bcrypt hash"
        string googleId "Google OAuth ID"
        string role "parent | admin"
        boolean isActive
        date createdAt
        date updatedAt
    }

    PARENTS {
        ObjectId _id PK
        ObjectId userId FK "Unique 1:1 users._id"
        string fullName
        string avatarUrl
        string bio
        object location "address, area, city, coordinates (2dsphere)"
        object preferences "preferredDays, timeSlots, locations, maxDistanceKm, ageRange, languages"
        object privacySettings "isProfileHidden, connectionPrivacy, messagePrivacy"
        object verification "isEmailVerified, isPhoneVerified, isVerifiedParent"
        object streak "currentWeeklyStreak, longestStreak, lastCompletedPlaydateWeek"
        date createdAt
        date updatedAt
    }

    CHILDREN {
        ObjectId _id PK
        ObjectId parentId FK "Ref: parents._id"
        string displayName
        date dateOfBirth "Tính tuổi chính xác"
        string gender "boy | girl | other"
        string avatarUrl
        string[] interests "Lego, vẽ tranh, khủng long..."
        string[] favoriteActivities "Đạp xe, bơi lội, công viên..."
        string[] personality "Năng động, hòa đồng, sáng tạo..."
        boolean isArchived "Soft delete"
        date createdAt
        date updatedAt
    }

    AUTH_TOKENS {
        ObjectId _id PK
        ObjectId userId FK "Ref: users._id (optional)"
        string target "Email hoặc Số điện thoại"
        string tokenHash
        string type "phone_otp | password_reset | email_verify"
        date expiresAt "TTL Index: tự hủy khi hết hạn"
        boolean isUsed
        int attempts "Số lần nhập sai, vô hiệu sau 5 lần"
        date createdAt
    }

    REFRESH_TOKENS {
        ObjectId _id PK
        ObjectId userId FK "Ref: users._id"
        string tokenHash UK "Unique, SHA-256"
        boolean isRevoked
        date revokedAt
        date expiresAt "TTL Index: tự hủy khi hết hạn"
        date createdAt
        date updatedAt
    }
```

---

### 2.3 Module 2: Khám phá & Kết nối Bạn chơi (Discovery & Connections)

> **Collections:** `swipes`, `connections` (tham chiếu `parents`, `children`)  
> **Nghiệp vụ:** Thao tác vuốt thẻ kết bạn (Like/Pass) theo quota ngày, quản lý mối quan hệ bạn bè 2 chiều chống trùng lặp.

```mermaid
erDiagram
    PARENTS ||--o{ SWIPES : "swiper (swiperParentId)"
    CHILDREN ||--o{ SWIPES : "target (targetChildId)"
    PARENTS ||--o{ SWIPES : "target's parent (targetParentId)"
    PARENTS ||--o{ CONNECTIONS : "requester (requesterId)"
    PARENTS ||--o{ CONNECTIONS : "recipient (recipientId)"

    SWIPES {
        ObjectId _id PK
        ObjectId swiperParentId FK "Ref: parents._id"
        ObjectId targetChildId FK "Ref: children._id"
        ObjectId targetParentId FK "Ref: parents._id"
        boolean isLike "true: Like, false: Pass"
        date createdAt "Dùng kiểm tra giới hạn 5 profiles/ngày"
    }

    CONNECTIONS {
        ObjectId _id PK
        ObjectId[] parents "Sorted [minId, maxId] triệt tiêu trùng 2 chiều"
        string pairKey "minId_maxId, unique khi pending/accepted"
        ObjectId requesterId FK "Ref: parents._id"
        ObjectId recipientId FK "Ref: parents._id"
        string status "pending | accepted | declined | removed"
        date connectedAt
        date declinedAt
        date removedAt
        date createdAt
        date updatedAt
    }
```

---

### 2.4 Module 3: Sự kiện Playdate, Đổi lịch, Đánh giá & Địa điểm (Playdates, Reschedule, Feedback & Places)

> **Collections:** `playdates`, `reschedule_requests`, `ratings_feedbacks`, `places_cache`  
> **Nghiệp vụ:** Tổ chức lịch gặp gỡ (không có activityCategory và endTime), quy trình đồng thuận đổi lịch (không có newEndTime), đánh giá sau buổi chơi, cache địa điểm Google Places.

```mermaid
erDiagram
    PARENTS ||--o{ PLAYDATES : "hostParentId"
    CHILDREN ||--o{ PLAYDATES : "hostChildId"
    PLAYDATES ||--o{ RESCHEDULE_REQUESTS : "has requests (1:N)"
    PARENTS ||--o{ RESCHEDULE_REQUESTS : "requestedBy"
    PLAYDATES ||--o{ RATINGS_FEEDBACKS : "receives ratings (1:N)"
    PARENTS ||--o{ RATINGS_FEEDBACKS : "author (parentId)"

    PLAYDATES {
        ObjectId _id PK
        ObjectId hostParentId FK "Ref: parents._id"
        ObjectId hostChildId FK "Ref: children._id"
        array participants "Array of { parentId, childId, status, invitedAt, respondedAt }"
        date scheduledDate "Ngày tổ chức"
        string time "Giờ bắt đầu, ví dụ: 09:00"
        string activity "Hoạt động: Dã ngoại, vẽ tranh, đá bóng..."
        object location "name, address, placeId, coordinates [lng, lat]"
        string note "Ghi chú cho các gia đình"
        string status "upcoming | completed | cancelled"
        object cancellation "cancelledBy, reason, cancelledAt"
        date completedAt
        ObjectId chatConversationId FK "Ref: conversations._id (1:1)"
        date createdAt
        date updatedAt
    }

    RESCHEDULE_REQUESTS {
        ObjectId _id PK
        ObjectId playdateId FK "Ref: playdates._id"
        ObjectId requestedBy FK "Ref: parents._id đề xuất"
        date newDate "Ngày mới đề xuất"
        string newStartTime "Giờ mới đề xuất (không có newEndTime)"
        object newLocation "name, address, placeId, coordinates"
        string reason "Lý do đổi lịch"
        string status "pending | accepted | declined | cancelled"
        array responses "Array of { parentId, status, respondedAt }"
        date resolvedAt
        date createdAt
        date updatedAt
    }

    RATINGS_FEEDBACKS {
        ObjectId _id PK
        ObjectId playdateId FK "Ref: playdates._id"
        ObjectId parentId FK "Ref: parents._id (Unique per playdate)"
        int rating "1 - 5 stars"
        string feedback "Nội dung nhận xét"
        string[] tags "Thân thiện, đúng giờ, hòa đồng..."
        date createdAt
    }

    PLACES_CACHE {
        ObjectId _id PK
        string googlePlaceId UK "Unique ID từ Google Places API"
        string name "Tên khu vui chơi/công viên"
        string address
        object coordinates "GeoJSON Point [lng, lat] (2dsphere)"
        string placeType "park | kids_cafe | playground | library | sports_center | workshop"
        float rating "Điểm đánh giá Google"
        int userRatingsTotal
        date lastFetchedAt "Kiểm tra TTL làm mới cache"
    }
```

---

### 2.5 Module 4: Trò chuyện, Thông báo & Trợ lý AI (Chat, Notifications & AI Assistant)

> **Collections:** `conversations`, `messages`, `notifications`, `ai_chat_sessions`  
> **Nghiệp vụ:** Nhắn tin trực tiếp 1-1, chat nhóm Playdate theo thời gian thực qua Socket.IO, thông báo in-app, hội thoại với AI Family Assistant.

```mermaid
erDiagram
    PLAYDATES ||--o| CONVERSATIONS : "playdateId (1:1 dedicated chat)"
    PARENTS ||--o{ CONVERSATIONS : "participants (Array of parentId)"
    CONVERSATIONS ||--o{ MESSAGES : "contains (1:N)"
    PARENTS ||--o{ MESSAGES : "senderId"
    USERS ||--o{ NOTIFICATIONS : "recipientId"
    PARENTS ||--o{ AI_CHAT_SESSIONS : "interacts (1:N)"

    CONVERSATIONS {
        ObjectId _id PK
        string type "direct | playdate"
        ObjectId[] participants "Array of parents._id"
        ObjectId playdateId FK "Ref: playdates._id (nếu type === 'playdate')"
        object lastMessage "messageId, senderId, content, type, sentAt"
        object unreadCounts "Map parentId -> unreadCount"
        boolean isActive
        date createdAt
        date updatedAt
    }

    MESSAGES {
        ObjectId _id PK
        ObjectId conversationId FK "Ref: conversations._id (Socket Room)"
        ObjectId senderId FK "Ref: parents._id"
        string type "text | image | emoji | system"
        string content
        string mediaUrl "Cloud Storage URL"
        array readBy "Array of { parentId, readAt }"
        boolean isDeleted "Thu hồi tin nhắn"
        date createdAt
    }

    NOTIFICATIONS {
        ObjectId _id PK
        ObjectId recipientId FK "Ref: users._id"
        string type "connection_request | playdate_invite | badge_unlocked | streak_reminder..."
        string title
        string body
        object data "playdateId, senderId, conversationId, badgeCode"
        boolean isRead
        date readAt
        date createdAt
    }

    AI_CHAT_SESSIONS {
        ObjectId _id PK
        ObjectId parentId FK "Ref: parents._id"
        string title "Tiêu đề cuộc trò chuyện"
        array messages "Array of { role, content, toolCalls, toolCallId, timestamp }"
        object tokenUsage "promptTokens, completionTokens, totalTokens"
        boolean isActive
        date createdAt
        date updatedAt
    }
```

---

### 2.6 Module 5: Gamification & Huy hiệu Thành tích (Gamification & Badges)

> **Collections:** `badges`, `user_badges`  
> **Nghiệp vụ:** Định nghĩa danh mục huy hiệu hệ thống, lưu vết và hiển thị thành tích phụ huynh mở khóa vĩnh viễn.

```mermaid
erDiagram
    BADGES ||--o{ USER_BADGES : "badge type (code)"
    PARENTS ||--o{ USER_BADGES : "unlocks (1:N)"

    BADGES {
        ObjectId _id PK
        string code UK "first_connection | first_playdate | 4_week_streak | 10_playdates..."
        string title "Tên huy hiệu"
        string description "Mô tả điều kiện đạt"
        string iconUrl
        int requirementCount "Số lần cần hoàn thành"
    }

    USER_BADGES {
        ObjectId _id PK
        ObjectId parentId FK "Ref: parents._id"
        string badgeCode FK "Ref: badges.code (Unique compound with parentId)"
        date unlockedAt "Thời điểm đạt huy hiệu"
    }
```

---

### 2.7 Module 6: Gói cước Premium, Thanh toán & Giới hạn hạn mức (Subscriptions, Payments & Quotas)

> **Collections:** `subscription_plans`, `subscriptions`, `payments`, `usage_quotas`  
> **Nghiệp vụ:** Định nghĩa gói Free/Premium, quản lý chu kỳ thuê bao, hóa đơn thanh toán, kiểm soát hạn mức tính năng độc lập theo ngày và tháng.

```mermaid
erDiagram
    SUBSCRIPTION_PLANS ||--o{ SUBSCRIPTIONS : "plan blueprint (planCode)"
    PARENTS ||--o{ SUBSCRIPTIONS : "subscribes (1:N)"
    SUBSCRIPTIONS ||--o{ PAYMENTS : "invoices (1:N)"
    PARENTS ||--o{ PAYMENTS : "payer (parentId)"
    PARENTS ||--o{ USAGE_QUOTAS : "tracks usage (1:N)"

    SUBSCRIPTION_PLANS {
        ObjectId _id PK
        string planCode UK "free | premium_monthly | premium_yearly"
        string name "Tên gói hiển thị"
        int price "0 hoặc số tiền VNĐ"
        string currency "VND"
        string billingCycle "monthly | yearly | none"
        object features "childProfilesLimit, discoveryViewLimitPerDay, connectionRequestsLimitPerMonth..."
        boolean isActive
    }

    SUBSCRIPTIONS {
        ObjectId _id PK
        ObjectId parentId FK "Ref: parents._id"
        string planCode FK "Ref: subscription_plans.planCode"
        string status "active | cancelled | expired"
        date startDate
        date endDate "null nếu gói Free"
        boolean autoRenew
        date cancelledAt
        date createdAt
        date updatedAt
    }

    PAYMENTS {
        ObjectId _id PK
        ObjectId subscriptionId FK "Ref: subscriptions._id"
        ObjectId parentId FK "Ref: parents._id"
        int amount "Số tiền giao dịch"
        string currency "VND"
        string paymentMethod "momo | vnpay | zalopay | credit_card"
        string transactionId UK "Unique mã giao dịch từ cổng thanh toán"
        string status "pending | success | failed"
        date paidAt
        date createdAt
    }

    USAGE_QUOTAS {
        ObjectId _id PK
        ObjectId parentId FK "Ref: parents._id"
        string periodType "daily | monthly"
        string periodValue "YYYY-MM-DD (daily) hoặc YYYY-MM (monthly)"
        object counters "discoveryViews (daily) | connectionRequests, playdatesCreated, aiAssistant (monthly)"
        date updatedAt
    }
```

---

### 2.8 Module 7: An toàn, Báo cáo Vi phạm & Chặn người dùng (Safety, Reports & Blocks)

> **Collections:** `reports`, `blocks`  
> **Nghiệp vụ:** Báo cáo nội dung xấu (User, Tin nhắn, Playdate), Admin tiếp nhận và xử lý vi phạm, cơ chế chặn 1 chiều bảo vệ người dùng.

```mermaid
erDiagram
    PARENTS ||--o{ BLOCKS : "blockerId"
    PARENTS ||--o{ BLOCKS : "blockedId"
    PARENTS ||--o{ REPORTS : "reporterId"
    PARENTS ||--o{ REPORTS : "reportedUserId"
    USERS ||--o{ REPORTS : "resolvedBy (Admin users._id)"
    MESSAGES ||--o{ REPORTS : "targetMessageId"
    PLAYDATES ||--o{ REPORTS : "targetPlaydateId"

    BLOCKS {
        ObjectId _id PK
        ObjectId blockerId FK "Ref: parents._id (người chặn)"
        ObjectId blockedId FK "Ref: parents._id (người bị chặn)"
        string reason "Lý do chặn"
        date createdAt
    }

    REPORTS {
        ObjectId _id PK
        ObjectId reporterId FK "Ref: parents._id (người báo cáo)"
        ObjectId reportedUserId FK "Ref: parents._id (người bị báo cáo)"
        string targetType "user | message | playdate"
        ObjectId targetMessageId FK "Ref: messages._id (nếu báo cáo tin nhắn)"
        ObjectId targetPlaydateId FK "Ref: playdates._id (nếu báo cáo playdate)"
        string reason "Lý do vi phạm"
        string description "Mô tả chi tiết"
        string[] evidenceUrls "Ảnh chụp bằng chứng"
        string status "pending | reviewing | resolved | dismissed"
        string adminNotes "Ghi chú của Admin"
        ObjectId resolvedBy FK "Ref: users._id của Admin"
        date resolvedAt
        date createdAt
        date updatedAt
    }
```

---

## 3. Chi tiết Cấu trúc Từng Collection & Thuộc tính (TypeScript Schemas)

### 3.1 `users` Collection (Tài khoản chung Parent & Admin)

Chỉ chứa các trường dùng chung cho quá trình xác thực và thông tin tài khoản cơ bản.

```typescript
interface IUser {
  _id: ObjectId;
  email: string; // Unique, indexed
  phone?: string; // Format E.164, indexed
  passwordHash?: string; // bcrypt hash (null nếu đăng nhập Google)
  googleId?: string; // Google OAuth ID (Mục 3.1)
  role: "parent" | "admin"; // Quyền truy cập (Default: 'parent')
  // Quản lý trạng thái tài khoản bởi Admin (Mục 15.1)
  isActive: Boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ email: 1 }` (unique)
- `{ phone: 1 }` (sparse)
- `{ googleId: 1 }` (sparse)
- `{ role: 1, isActive: 1 }`

---

### 3.2 `parents` Collection (Hồ sơ chuyên biệt của Phụ huynh)

Tách riêng khỏi `users`, liên kết 1:1 với `users` thông qua `userId`. Chứa toàn bộ nghiệp vụ đặc thù của phụ huynh, bao gồm **preferences**, vị trí địa lý, quyền riêng tư, xác thực và streak.

```typescript
interface IParentPreferences {
  preferredPlaydateDays?: ("weekday" | "weekend")[]; // Ngày rảnh: ngày trong tuần / cuối tuần
  preferredTimeSlots?: ("morning" | "afternoon" | "evening")[]; // Khung giờ: sáng / chiều / tối
  preferredLocations?: ("indoor" | "outdoor" | "park" | "kids_cafe" | "home")[]; // Địa điểm ưa thích
  maxDistanceKm?: number; // Bán kính tìm kiếm bạn chơi tối đa (km)
  preferredAgeRange?: { min: number; max: number }; // Khoảng tuổi bạn chơi mong muốn
  languages?: string[]; // Ngôn ngữ giao tiếp: ['Vietnamese', 'English']
  additionalNotes?: string; // Ghi chú phong cách nuôi dạy hoặc lưu ý riêng
}

interface IParent {
  _id: ObjectId;
  userId: ObjectId; // Tham chiếu 1:1 users._id (Unique, Indexed)
  fullName: string; // Họ tên hiển thị
  avatarUrl?: string; // Ảnh đại diện (Cloud Storage URL)
  bio?: string;

  // Địa lý & Tọa độ (Mục 3.2, 4.2)
  location: {
    address?: string;
    area?: string; // Quận/Huyện/Khu vực
    city?: string; // Tỉnh/Thành phố
    coordinates?: {
      // GeoJSON Point phục vụ Smart Matching và tính khoảng cách
      type: "Point";
      coordinates: [number, number]; // [longitude, latitude]
    };
  };

  // Tiêu chí Matching & Sở thích của gia đình (Mục 4.2 Smart Matching)
  preferences: IParentPreferences;

  // Quyền riêng tư & An toàn (Mục 3.2, 12.2)
  privacySettings: {
    isProfileHidden: boolean; // Ẩn Parent và Child khỏi Discovery (Default: false)
    connectionPrivacy: "everyone" | "nobody"; // Quyền nhận Connection Request (Default: 'everyone')
    messagePrivacy: "connected_only"; // Chỉ Connected Parents mới nhắn tin (Default: 'connected_only')
  };

  // Xác thực phụ huynh (Mục 13 Verification)
  verification: {
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
    isVerifiedParent: boolean; // true khi cả Email + Phone đã verify (Hiện Verified Badge)
  };

  // Gamification: Streak hàng tuần (Mục 10.1)
  streak: {
    currentWeeklyStreak: number; // Số tuần liên tiếp (Default: 0)
    longestStreak: number;
    lastCompletedPlaydateWeek?: string; // Dạng 'YYYY-WW' (ví dụ: '2026-W37')
    streakUpdatedAt?: Date;
  };

  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ userId: 1 }` (unique)
- `{ "location.coordinates": "2dsphere" }` (hỗ trợ Geospatial `$near` tính khoảng cách)
- `{ "privacySettings.isProfileHidden": 1 }`

---

### 3.3 `auth_tokens` Collection (OTP & Xác thực dùng 1 lần)

Quản lý tất cả các mã OTP và mã xác thực tạm thời dùng 1 lần: Phone OTP (Mục 13), Password Reset Token (Mục 3.1), Email Verification Token,...

```typescript
interface IAuthToken {
  _id: ObjectId;
  userId?: ObjectId; // Tham chiếu users._id (nếu xác định được user)
  target: string; // Email hoặc Số điện thoại (ví dụ: "+84987654321" hoặc "parent@gmail.com")
  tokenHash: string; // Hash của mã OTP hoặc token ngẫu nhiên (SHA-256 / bcrypt)
  type: "phone_otp" | "password_reset" | "email_verify"; // Mục đích xác thực
  isUsed: boolean; // Trạng thái: true nếu đã xác thực thành công (Default: false)
  attempts: number; // Số lần nhập sai mã (Default: 0). Đạt OTP_CONFIG.MAX_ATTEMPTS (5) thì mã bị vô hiệu
  expiresAt: Date; // Thời điểm hết hạn (OTP: 3-5 phút, Reset token: 15-30 phút)
  createdAt: Date;
}
```

_Indexes:_

- `{ target: 1, type: 1 }`
- `{ tokenHash: 1 }`
- `{ expiresAt: 1 }` (`expireAfterSeconds: 0` - TTL Index tự động xóa token khi hết hạn)

---

### 3.4 `refresh_tokens` Collection (Phiên đăng nhập & Cấp lại Access Token)

Quản lý refresh token để duy trì phiên đăng nhập bảo mật và cấp lại access token (Mục 3.1).

```typescript
interface IRefreshToken {
  _id: ObjectId;
  userId: ObjectId; // Tham chiếu users._id
  tokenHash: string; // Hash của Refresh Token (SHA-256)
  isRevoked: boolean; // true nếu token đã bị thu hồi/đăng xuất (Default: false)
  revokedAt?: Date; // Thời điểm thu hồi/đăng xuất
  expiresAt: Date; // Hạn dùng của refresh token (ví dụ: 30 ngày)
  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ tokenHash: 1 }` (unique)
- `{ userId: 1, isRevoked: 1 }`
- `{ expiresAt: 1 }` (`expireAfterSeconds: 0` - TTL Index tự động xóa token khi hết hạn)

---

### 3.5 `children` Collection (Hồ sơ Trẻ em)

_Ánh xạ: Mục 3.3, 4.2._

```typescript
interface IChild {
  _id: ObjectId;
  parentId: ObjectId; // Tham chiếu parents._id (Indexed)

  displayName: string; // Tên hoặc biệt danh
  dateOfBirth: Date; // Ngày sinh để tính tuổi chính xác
  gender: "boy" | "girl" | "other";
  avatarUrl?: string; // Ảnh của bé

  interests: string[]; // ['Lego', 'Vẽ tranh', 'Khủng long', 'Âm nhạc']
  favoriteActivities: string[]; // ['Đạp xe', 'Bơi lội', 'Đi công viên', 'Đọc sách']
  personality: string[]; // ['Năng động', 'Sáng tạo', 'Điềm tĩnh', 'Hòa đồng']
  isArchived: boolean; // Soft delete khi phụ huynh xóa hồ sơ

  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ parentId: 1, isArchived: 1 }`
- `{ dateOfBirth: 1, gender: 1 }`
- `{ interests: 1 }`
- `{ favoriteActivities: 1 }`

---

### 3.6 `swipes` Collection (Lịch sử Vuốt thẻ Discovery)

_Ánh xạ: Mục 4.1, 14.1._

```typescript
interface ISwipe {
  _id: ObjectId;
  swiperParentId: ObjectId; // Tham chiếu parents._id
  targetChildId: ObjectId; // Tham chiếu children._id
  targetParentId: ObjectId; // Tham chiếu parents._id của bé
  isLike: boolean; // true: Like, false: Pass
  createdAt: Date; // Kiểm tra giới hạn 5 profiles/ngày cho Free Plan
}
```

_Indexes:_

- `{ swiperParentId: 1, targetChildId: 1 }` (unique)
- `{ swiperParentId: 1, createdAt: 1 }`

---

### 3.7 `connections` Collection (Kết nối Bạn chơi)

_Ánh xạ: Mục 4.3._

```typescript
interface IConnection {
  _id: ObjectId;
  parents: [ObjectId, ObjectId]; // Mảng 2 phần tử luôn được sort [minId, maxId] để triệt tiêu bài toán đảo chiều (Reverse Duplicate)
  pairKey: string; // `${minId}_${maxId}`, tự sinh từ parents trước khi validate; dùng làm khóa unique của cặp
  requesterId: ObjectId; // Tham chiếu parents._id gửi lời mời
  recipientId: ObjectId; // Tham chiếu parents._id nhận lời mời
  status: "pending" | "accepted" | "declined" | "removed";
  connectedAt?: Date;
  declinedAt?: Date;
  removedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ pairKey: 1 }` (unique, `partialFilterExpression: { status: { $in: ["pending", "accepted"] } }` - Chống trùng 2 chiều khi đang chờ hoặc đã kết nối; cho phép gửi lại nếu bị `declined` hoặc `removed`)
  - ⚠️ Không đặt unique trên mảng `parents`: index trên mảng là multikey nên MongoDB kiểm tra trùng theo **từng phần tử**, khiến mỗi phụ huynh chỉ có được 1 kết nối pending/accepted.
- `{ parents: 1, status: 1 }` (Tìm danh sách bạn bè / trạng thái quan hệ 2 chiều cực nhanh)
- `{ recipientId: 1, status: 1 }` (Lấy danh sách lời mời kết nối đang chờ duyệt)
- `{ requesterId: 1, createdAt: 1 }` (Kiểm tra quota gửi request trong tháng)

---

### 3.8 `conversations` & `messages` Collections (Trò chuyện)

_Ánh xạ: Mục 5.1 (Direct Chat) & 5.2 (Playdate Chat)._

```typescript
interface IConversation {
  _id: ObjectId;
  type: "direct" | "playdate";
  participants: ObjectId[]; // Danh sách parents._id (Socket.IO Room = conversation._id)
  playdateId?: ObjectId; // Tham chiếu playdates._id (nếu type === 'playdate')

  lastMessage?: {
    messageId: ObjectId;
    senderId: ObjectId; // Tham chiếu parents._id
    content: string;
    type: "text" | "image" | "emoji" | "system";
    sentAt: Date;
  };

  // Quản lý số tin chưa đọc tức thì cho Socket.IO badge UI
  unreadCounts?: Record<string, number>; // Key: parentId (string), Value: số tin chưa đọc

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface IMessage {
  _id: ObjectId;
  conversationId: ObjectId; // Tham chiếu conversations._id (Socket Room)
  senderId: ObjectId; // Tham chiếu parents._id
  type: "text" | "image" | "emoji" | "system";
  content: string;
  mediaUrl?: string; // Cloud Storage URL (nếu gửi hình ảnh)

  // Quản lý trạng thái đã xem qua Socket.IO (Event: 'message_read')
  readBy: Array<{
    parentId: ObjectId; // Tham chiếu parents._id
    readAt: Date;
  }>;

  isDeleted: boolean; // Thu hồi tin nhắn (Socket.IO Event: 'message_deleted')
  createdAt: Date;
}
```

_Indexes:_

- `conversations`: `{ participants: 1, updatedAt: -1 }` (Load danh sách chat gần nhất)
- `messages`: `{ conversationId: 1, createdAt: -1 }` (Phân trang lịch sử chat mượt mà cho Socket.IO)

---

### 3.9 `playdates` Collection (Sự kiện Playdate)

_Ánh xạ: Mục 6. Đã loại bỏ `activityCategory` và `endTime` theo yêu cầu._

```typescript
interface IPlaydateParticipant {
  parentId: ObjectId; // Tham chiếu parents._id
  childId: ObjectId; // Tham chiếu children._id
  status: "pending" | "accepted" | "declined";
  invitedAt: Date;
  respondedAt?: Date;
}

interface IPlaydate {
  _id: ObjectId;
  hostParentId: ObjectId; // Tham chiếu parents._id
  hostChildId: ObjectId; // Tham chiếu children._id
  participants: IPlaydateParticipant[];

  scheduledDate: Date; // Ngày tổ chức
  time: string; // Giờ bắt đầu (ví dụ: "09:00", "15:30")
  activity: string; // Hoạt động: Picnic, công viên, vẽ tranh, đá bóng...

  location: {
    name: string; // "Công viên Gia Định", "TiNiWorld Landmark 81"
    address: string;
    placeId?: string; // Google Place ID
    coordinates?: {
      type: "Point";
      coordinates: [number, number]; // [lng, lat]
    };
  };

  note?: string; // Ghi chú cho các gia đình tham gia
  status: "upcoming" | "completed" | "cancelled";

  cancellation?: {
    cancelledBy: ObjectId;
    reason?: string;
    cancelledAt: Date;
  };

  completedAt?: Date;
  chatConversationId?: ObjectId; // Tham chiếu conversations._id (Chat riêng cho Playdate)

  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ hostParentId: 1, status: 1 }`
- `{ "participants.parentId": 1, status: 1 }`
- `{ scheduledDate: 1, status: 1 }`
- `{ "location.coordinates": "2dsphere" }`

---

### 3.10 `reschedule_requests` Collection (Yêu cầu Đổi lịch Playdate)

_Ánh xạ: Mục 6.2. Đã loại bỏ `newEndTime` theo yêu cầu._

```typescript
interface IRescheduleRequest {
  _id: ObjectId;
  playdateId: ObjectId; // Tham chiếu playdates._id
  requestedBy: ObjectId; // Tham chiếu parents._id

  newDate: Date; // Ngày mới đề xuất
  newStartTime: string; // Giờ mới đề xuất
  newLocation?: {
    name: string;
    address: string;
    placeId?: string;
    coordinates?: {
      type: "Point";
      coordinates: [number, number];
    };
  };
  reason?: string;

  // Trạng thái theo quy tắc Mục 6.2: Cần tất cả Accepted Participants đồng ý
  status: "pending" | "accepted" | "declined" | "cancelled";

  responses: Array<{
    parentId: ObjectId; // Tham chiếu parents._id
    status: "pending" | "accepted" | "declined";
    respondedAt?: Date;
  }>;

  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ playdateId: 1, status: 1 }`
- `{ requestedBy: 1 }`

---

### 3.11 `ratings_feedbacks` Collection (Đánh giá Playdate)

_Ánh xạ: Mục 11._

```typescript
interface IRatingFeedback {
  _id: ObjectId;
  playdateId: ObjectId; // Tham chiếu playdates._id
  parentId: ObjectId; // Tham chiếu parents._id
  rating: number; // 1 - 5 ⭐
  feedback?: string;
  tags?: string[];
  createdAt: Date;
}
```

_Indexes:_

- `{ playdateId: 1, parentId: 1 }` (unique: 1 đánh giá / phụ huynh / playdate)

---

### 3.12 `ai_chat_sessions` Collection (AI Assistant Agent)

_Ánh xạ: Mục 8._

```typescript
interface IAIChatSession {
  _id: ObjectId;
  parentId: ObjectId; // Tham chiếu parents._id
  title: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    toolCalls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
    toolCallId?: string;
    timestamp: Date;
  }>;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

---

### 3.13 `badges` & `user_badges` Collections (Gamification)

_Ánh xạ: Mục 10.2._

```typescript
interface IBadge {
  _id: ObjectId;
  code: string; // 'first_connection', 'first_playdate', '4_week_streak', '10_playdates', 'social_family', 'explorer'
  title: string;
  description: string;
  iconUrl: string;
  requirementCount: number;
}

interface IUserBadge {
  _id: ObjectId;
  parentId: ObjectId; // Tham chiếu parents._id
  badgeCode: string; // Tham chiếu badges.code
  unlockedAt: Date; // Mở khóa vĩnh viễn
}
```

---

### 3.14 `notifications`, `blocks`, `reports` & `places_cache` Collections

#### A. `notifications` Collection (Mục 5.3)

```typescript
interface INotification {
  _id: ObjectId;
  recipientId: ObjectId; // Tham chiếu users._id (nhận thông báo)
  type:
    | "connection_request"
    | "connection_accepted"
    | "playdate_invite"
    | "playdate_reminder"
    | "badge_unlocked"
    | "streak_reminder"
    | "system";
  title: string;
  body: string;
  data?: {
    senderId?: ObjectId;
    playdateId?: ObjectId;
    conversationId?: ObjectId;
    badgeCode?: string;
  };
  isRead: boolean; // Default: false
  readAt?: Date;
  createdAt: Date;
}
```

_Indexes:_

- `{ recipientId: 1, isRead: 1, createdAt: -1 }` (Lấy thông báo chưa đọc / mới nhất)

#### B. `blocks` Collection (Mục 12.1)

```typescript
interface IBlock {
  _id: ObjectId;
  blockerId: ObjectId; // Tham chiếu parents._id (Người thực hiện chặn)
  blockedId: ObjectId; // Tham chiếu parents._id (Người bị chặn)
  reason?: string;
  createdAt: Date;
}
```

_Indexes:_

- `{ blockerId: 1, blockedId: 1 }` (unique - Một chiều chặn 1 lần)
- `{ blockerId: 1 }`

#### C. `reports` Collection (Mục 12.1 & 15.4)

```typescript
interface IReport {
  _id: ObjectId;
  reporterId: ObjectId; // Tham chiếu parents._id gửi báo cáo
  reportedUserId: ObjectId; // Tham chiếu parents._id bị báo cáo
  targetType: "user" | "message" | "playdate";
  targetMessageId?: ObjectId; // Tham chiếu messages._id (nếu báo cáo tin nhắn)
  targetPlaydateId?: ObjectId; // Tham chiếu playdates._id (nếu báo cáo playdate)
  reason: string; // Lý do vi phạm
  description?: string; // Chi tiết phản ánh
  evidenceUrls?: string[]; // Ảnh chụp màn hình / bằng chứng
  status: "pending" | "reviewing" | "resolved" | "dismissed"; // Default: 'pending'
  adminNotes?: string; // Ghi chú xử lý của Admin
  resolvedBy?: ObjectId; // Tham chiếu users._id của Admin xử lý
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ status: 1, createdAt: -1 }` (Admin lọc danh sách report theo trạng thái)
- `{ reportedUserId: 1 }` (Thống kê số lần bị report của một user)

#### D. `places_cache` Collection (Mục 7.2)

```typescript
interface IPlacesCache {
  _id: ObjectId;
  googlePlaceId: string; // Unique ID từ Google Places API
  name: string; // Tên địa điểm (ví dụ: "Khu vui chơi KizCiti")
  address: string;
  coordinates: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
  };
  placeType:
    | "park"
    | "kids_cafe"
    | "playground"
    | "library"
    | "sports_center"
    | "workshop";
  rating?: number;
  userRatingsTotal?: number;
  lastFetchedAt: Date; // Dùng để kiểm tra TTL làm mới cache (ví dụ sau 30 ngày)
}
```

_Indexes:_

- `{ googlePlaceId: 1 }` (unique)
- `{ coordinates: "2dsphere" }` (Tìm kiếm địa điểm vui chơi xung quanh tọa độ phụ huynh)

---

### 3.15 `subscription_plans`, `subscriptions`, `payments` & `usage_quotas`

#### A. `subscription_plans` Collection (Mục 14 & 15.5)

```typescript
interface ISubscriptionPlan {
  _id: ObjectId;
  planCode: "free" | "premium_monthly" | "premium_yearly";
  name: string; // "Gói Miễn Phí", "Gói Premium Hàng Tháng", "Gói Premium Hàng Năm"
  price: number; // 0 VNĐ hoặc giá theo tháng/năm
  currency: "VND";
  billingCycle: "monthly" | "yearly" | "none";
  features: {
    childProfilesLimit: number; // Free: 1, Premium: -1 (unlimited)
    discoveryViewLimitPerDay: number; // Free: 5, Premium: -1
    connectionRequestsLimitPerMonth: number; // Free: 5, Premium: -1
    playdatesLimitPerMonth: number; // Free: 3, Premium: -1
    aiAssistantLimitPerMonth: number; // Free: 5, Premium: -1
  };
  isActive: boolean; // Default: true
}
```

_Indexes:_

- `{ planCode: 1 }` (unique)

#### B. `subscriptions` Collection (Mục 14.2)

```typescript
interface ISubscription {
  _id: ObjectId;
  parentId: ObjectId; // Tham chiếu parents._id
  planCode: "free" | "premium_monthly" | "premium_yearly";
  status: "active" | "cancelled" | "expired";
  startDate: Date;
  endDate?: Date; // null nếu là gói Free
  autoRenew: boolean; // Default: true
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

_Indexes:_

- `{ parentId: 1, status: 1 }` (Kiểm tra gói dịch vụ hiện tại của phụ huynh)

#### C. `payments` Collection (Mục 14.2 & 15.6)

```typescript
interface IPayment {
  _id: ObjectId;
  subscriptionId: ObjectId; // Tham chiếu subscriptions._id
  parentId: ObjectId; // Tham chiếu parents._id
  amount: number; // Số tiền thanh toán (VNĐ)
  currency: "VND";
  paymentMethod: "vnpay" | "momo" | "zalopay" | "credit_card";
  transactionId: string; // Mã giao dịch do cổng thanh toán trả về
  status: "pending" | "success" | "failed";
  paidAt?: Date;
  createdAt: Date;
}
```

_Indexes:_

- `{ transactionId: 1 }` (unique)
- `{ parentId: 1, createdAt: -1 }` (Lịch sử thanh toán của phụ huynh)

#### D. `usage_quotas` Collection (Mục 14.1 Feature Quota Limiting)

Sử dụng `periodType` ('daily' | 'monthly') và `periodValue` để tách biệt hoàn toàn hạn mức theo ngày và tháng, giải quyết triệt để vấn đề conflict chu kỳ reset.

```typescript
interface IUsageQuota {
  _id: ObjectId;
  parentId: ObjectId; // Tham chiếu parents._id
  periodType: "daily" | "monthly";
  periodValue: string; // 'YYYY-MM-DD' (nếu daily) hoặc 'YYYY-MM' (nếu monthly)

  counters: {
    // Chỉ dùng khi periodType === 'daily':
    discoveryViews?: number; // Free: tối đa 5 profiles/ngày

    // Chỉ dùng khi periodType === 'monthly':
    connectionRequests?: number; // Free: tối đa 5 requests/tháng
    playdatesCreated?: number; // Free: tối đa 3 playdates/tháng
    playdatesJoined?: number; // Free: tối đa 3 playdates/tháng
    aiAssistantRequests?: number; // Free: tối đa 5 requests/tháng
  };

  updatedAt: Date;
}
```

_Indexes:_

- `{ parentId: 1, periodType: 1, periodValue: 1 }` (unique - Mỗi parent chỉ có 1 document cho mỗi ngày và mỗi tháng)
