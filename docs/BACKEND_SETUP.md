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
http://localhost:5000
```

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
Server running on port 5000
```

You can also verify data using MongoDB Compass.

---

# Deploy on Render & PayOS Webhook

Render's free instances **sleep after 15 minutes without requests** and take ~30-60 s to start again (the first request wakes them).

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
