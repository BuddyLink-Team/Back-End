# BuddyLink Backend Setup

## Install Dependencies

```bash
cd Back-End

npm install
```

---

# Environment Setup

Create:

```bash
.env
```

Copy from:

```bash
.env.example
```

Example:

```env
PORT=5000

CLIENT_URL=http://localhost:5173

ADMIN_PORT=5001

ADMIN_CLIENT_URL=http://localhost:5174

mongodb+srv://buddylink_admin:<db_password>@cluster0.wg1nfcj.mongodb.net/buddylink_db

JWT_SECRET=your_jwt_secret

JWT_REFRESH_SECRET=your_refresh_secret
```

---

# MongoDB Atlas Setup

> Atlas Project và Cluster đã được tạo bởi Team Lead.

## Step 1: Accept Atlas Invitation

1. Kiểm tra email được Team Lead mời.
2. Nhấn:

```text
Accept Invitation
```

3. Đăng nhập hoặc tạo tài khoản MongoDB Atlas.
4. Sau khi tham gia thành công, bạn sẽ thấy Project của nhóm.

---

## Step 2: Get Connection String

Copy MONGODB_URI trong .env.example thay bằng username và password của bản thân.
Có thể dùng username buddylink_admin và password viết liền, bỏ dấu \*

```env
mongodb+srv://buddylink_admin:<db_password>@cluster0.wg1nfcj.mongodb.net/buddylink_db
```

---

## Connect Atlas Using Compass

Mở Mongo Compass trên máy.

Paste connection string MONGODB_URI đã define

Nhấn:

```text
Connect
```

---

## What Compass Is Used For

Compass giúp:

- Xem collections
- Xem documents
- Insert test data
- Kiểm tra dữ liệu
- Export schema
- Phân tích database structure

Đặc biệt hữu ích cho:

```text
Report 4 - Database Design
```

khi cần xuất schema MongoDB.

---

# Generate JWT Secret

JWT Secret không được cấp bởi bất kỳ nền tảng nào.

Developer tự tạo và lưu trong `.env`.

---

## Generate JWT_SECRET

Run:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Ví dụ:

```text
4db3f8df5f34d1dcb4d2f87db8e7d71f9c8f4b7f1e5f4e4d0a2d3f7e9c1f2a6f4c7d9e3b5a1c8d2f6e7b9a3d1c5f7e9
```

---

## Generate JWT_REFRESH_SECRET

Run again:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Ví dụ:

```text
9f8e7d6c5b4a39281716151413121110abcdefabcdefabcdefabcdefabcdefabcdef
```

---

## Add To .env

```env
JWT_SECRET=<generated_secret>

JWT_REFRESH_SECRET=<generated_refresh_secret>
```

---

## Security Notes

Never commit:

```env
JWT_SECRET

JWT_REFRESH_SECRET
```

to GitHub.

Always store secrets inside:

```env
.env
```

Add to `.gitignore`:

```gitignore
.env
```

---

# Run Project

```bash
npm run dev
```

Backend runs at:

```text
http://localhost:5000/api/v1         # Parent app API (+ Socket.io)
http://localhost:5001/api/v1/admin   # Admin portal API (ADMIN_PORT, + Socket.io namespace /admin)
```

The admin API only starts when `ADMIN_PORT` is set. See [Admin portal API](#admin-portal-api) below.

---

# Testing (Jest & In-Memory MongoDB)

Run automated test suite:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

> **Note:** Tests run with `mongodb-memory-server` in RAM. You do **not** need a local running MongoDB or Atlas connection to run tests.

---

# Verify Connection

Expected output:

```text
MongoDB Connected
BuddyLink server running in development mode at http://localhost:5000
BuddyLink admin server running at http://localhost:5001
```

You can also verify data using MongoDB Compass.

---

# Admin Portal API

The admin portal has its own API, separate from the parent app:

| | Parent app API | Admin portal API |
|---|---|---|
| Express app | `src/app.js` | `src/admin-app.js` |
| Base path | `/api/v1` | `/api/v1/admin` |
| Local port | `PORT` (5000) | `ADMIN_PORT` (5001) |
| CORS origin | `CLIENT_URL` | `ADMIN_CLIENT_URL` |
| Production | Render service `npm start` | Separate Render service `npm run start:admin` |

- Admin routes live in `src/modules/admin/admin.route.js` and are mounted **only** in `admin-app.js`. Never mount them in `app.js`.
- Tokens carry an audience (`aud`): `app` for the parent app, `admin` for the admin portal (`TOKEN_AUDIENCES` in `auth.constants.js`). `authenticate` and refresh only accept tokens issued for the app serving the request, so a parent token gets 401 on the admin API and an admin token gets 401 on the parent API. On Socket.io, the parent API only accepts parent tokens and the `/admin` namespace of the admin API only accepts admin tokens.
- Admin accounts cannot sign in on the parent app (`/auth/login`, `/auth/google` answer `403 ADMIN_PORTAL_REQUIRED`).
- Admin endpoints so far: `POST /auth/login` (rate limited: 10 / 15 min), `POST /auth/refresh-token`, `POST /auth/logout`, `GET /auth/me`, `/user/*` (own profile & password). Everything after login requires `authenticate` + `authorizeRoles('admin')`.
- Parent & child management (BUD-31): `GET /users` (search, `isActive`, `isVerified`, page, limit), `GET /users/:id`, `PATCH /users/:id/status` (`{ isActive }`: locking revokes the parent's refresh tokens and closes their open Socket.io connections), `GET /children` (search, gender, `minAge` / `maxAge`, `isArchived`), `GET /children/:id`, `GET /payments?parentId=` (payment history of a parent).
- Playdate & connection oversight (BUD-33): `GET /playdates` (search, `status`, `fromDate` / `toDate`), `GET /playdates/stats` (`{ total, upcoming, completed, cancelled }`), `GET /playdates/:id` (participants + pending reschedule), `PATCH /playdates/:id/cancel` (`{ reason }` required: cancels pending reschedules and gives back the participation of families still in), `GET /connections` (search by parent or child name, `status`), `GET /connections/stats` (`{ total, pending, accepted, declined, removed }`), `GET /connections/:id`, `DELETE /connections/:id` (`{ reason? }`: pending or accepted only, otherwise `409 INVALID_CONNECTION_STATE`). Parent locations are sent as area / city only.
- Dashboard (BUD-29): `GET /analytics` (`fromDate`, `toDate`, `groupBy`; 30 days by default, 12 months at most), `GET /notifications` (`category`, `severity`, `isRead`, page, limit), `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all?category=`.
- Safety & reports moderation (BUD-32): `GET /reports` (`status`, `severity`, `category`, `targetType`, `assignedTo=me`, `isOverdue`, search by parent name or email, `fromDate` / `toDate`, `sort=queue|newest|oldest`; severity then oldest first by default), `GET /reports/stats`, `GET /reports/:id`, `PATCH /reports/:id/review` (`{ action: claim|takeover }`), `PATCH /reports/:id/severity`, `POST /reports/:id/action` (`{ type: warn|delete_message|cancel_playdate|suspend|ban, durationDays?, note? }`: needs `reviewing`; already applied or already handled target `409 ACTION_ALREADY_APPLIED`, target gone `404 TARGET_NOT_FOUND`), `PATCH /reports/:id/resolve` (`{ status, resolution, adminNotes, applyToRelatedReportIds? }`: a pending report can only be dismissed; related reports need a suspension or a ban and get the same one; closed `409 REPORT_ALREADY_CLOSED`), `PATCH /reports/:id/reopen` (`{ note }`). Run `node scripts/migrate-report-severities.js` once to give existing reports a severity.
- A suspension ends by itself: signing in lifts it right away and `suspension-expiry.job.js` lifts the others every 15 minutes. Unlocking from `PATCH /users/:id/status` also ends a suspension or a ban.
- Sanctions reach the parent sockets in realtime (`account_locked` then disconnect, `message_deleted`). The parent API opens MongoDB change streams on `users` and `messages`, because admins act from another process in production. On a standalone MongoDB there are no change streams: the moderation code sends them directly, which works locally because `npm run dev` runs both APIs in one process.
- Admin notifications are created by listeners in whichever process emits the event. The admin API opens a MongoDB change stream on `admin_notifications` and sends each new row on the `/admin` namespace (`admin:notification:new`, `admin:notification:unread-count`). On a standalone MongoDB there are no change streams: the process sends them directly, which works locally because `npm run dev` runs both APIs in one process.
- Background jobs and seeding only run in `src/server.js` (parent API). `src/admin-server.js` connects MongoDB, serves the admin API and the `/admin` namespace.

---

# Deploy on Render & PayOS Webhook

Render's free instances **sleep after 15 minutes without requests** and take ~30-60 s to start again (the first request wakes them).

> Full step-by-step guide (Render + Vercel, env variables, checklist): [DEPLOYMENT.md](DEPLOYMENT.md).

## Two web services

Render exposes one port per service, so the admin API is its own Web Service from the same repo:

| Service | Start command | Environment |
|---|---|---|
| Parent API | `npm start` | Current variables. **Do not set `ADMIN_PORT`.** |
| Admin API | `npm run start:admin` | Same `MONGODB_URI` as the parent API, its own `JWT_*` secrets, `ADMIN_CLIENT_URL=<admin frontend URL>`, `TRUST_PROXY=1` |

Both services listen on the `PORT` Render provides.

## Register the PayOS webhook

Webhook URL: `https://<your-api>.onrender.com/api/v1/subscriptions/webhook` (PayOS dashboard → Webhook).

When the URL is saved, PayOS immediately POSTs a signed test payload (`orderCode: 123`); the API answers it with 200. If the instance is asleep, the ping can time out while it starts: open `https://<your-api>.onrender.com/api/v1` first so the server is awake, then save the URL.

## If a webhook is missed

Payments never depend on the webhook alone:

- The checkout page polls `GET /subscriptions/payments/verify/:orderCode`, which asks PayOS directly.
- Orders still unpaid after their link expired are reconciled with PayOS (at startup, every hour by the subscription expiry job, and when a parent opens the payment history): a `PAID` order is fulfilled, the others are closed as `expired` / `cancelled`.

---

# Required Packages (Don't Need To Run Again)

```bash
npm init -y

npm install express mongoose dotenv cors cookie-parser helmet express-rate-limit

npm install bcryptjs jsonwebtoken

npm install express-validator

npm install pino pino-pretty

npm install socket.io

npm install node-cron

npm install @google/genai  @payos/node cloudinary multer nodemailer axios exceljs

npm install nodemon --save-dev

npm install jest supertest mongodb-memory-server --save-dev

```
