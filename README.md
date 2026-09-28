# BuddyLink - Backend API

Modular Monolith backend for **BuddyLink** (Parenting & Child Playdate Matchmaking Platform), built with **Node.js**, **Express**, **MongoDB (Mongoose)**, **Socket.io**, and **AI Assistants**.

---

## 🚀 Tech Stack

- **Runtime**: Node.js (`>=20.0.0`, recommended `v22.x LTS`)
- **Framework**: Express.js (ES Modules)
- **Database**: MongoDB via Mongoose ODM
- **Realtime**: Socket.io
- **Logger**: Pino & Pino-pretty
- **Security**: Helmet, CORS, Express-rate-limit, Cookie-parser
- **Testing**: Jest (ESM mode), Supertest, MongoDB Memory Server

---

## 📁 Project Structure

```text
src/
├── app.js               # Express app configuration & middleware pipeline
├── server.js            # HTTP Server & Socket.io entry point
├── config/              # Environment variables, database, socket setups
├── middlewares/         # Auth, validation, roles, and error handlers
├── modules/             # Business modules (User, Playdate, Chat, AI, etc.)
├── shared/              # Shared constants, helpers, logger, custom errors
└── sockets/             # Socket.io event handlers
docs/                    # Comprehensive system architecture & DB schemas
test/                    # Jest automated integration & unit tests
```

---

## 🛠️ Getting Started

### 1. Prerequisites
- Node.js (version 20 or 22 LTS recommended)
- MongoDB instance (Local or MongoDB Atlas)

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env` in the root folder and configure:
```bash
cp .env.example .env
```

Key environment variables:
- `PORT`: Server port (default: `5000`)
- `NODE_ENV`: `development` | `production` | `test`
- `CLIENT_URL`: Frontend origin URL (e.g. `http://localhost:5173`)
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET` & `JWT_REFRESH_SECRET`: Secrets for signing tokens

### 4. Run Application
- **Development mode (with auto-reload)**:
  ```bash
  npm run dev
  ```
- **Production mode**:
  ```bash
  npm start
  ```
- **Run Tests**:
  ```bash
  npm test
  ```

---

## 📖 Documentation

Detailed documentation is available in the [`docs/`](./docs) folder:
- [Architecture Guide](./docs/BUDDYLINK_BACKEND_ARCHITECTURE.md)
- [Database Schema](./docs/DATABASE_SCHEMA.md)
- [AI Guide](./docs/BACKEND_AI_GUIDE.md)
- [Setup Guide](./docs/BACKEND_SETUP.md)
