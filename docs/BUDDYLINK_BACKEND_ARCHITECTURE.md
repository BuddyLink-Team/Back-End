# BuddyLink Backend Architecture

## 1. Architecture Overview (Modular Monolith)

The backend follows a **Modular Monolith** pattern combined with a **Layered Architecture**:

```text
Route → Controller → Service → Repository → Model (MongoDB)
```

- **Feature Modules:** Self-contained business features located in `modules/<feature>/`.
- **Shared Infrastructure:** Common components in `config/`, `middlewares/`, `shared/`, `integrations/`, `sockets/`, and `jobs/`.

---

## 2. Project Folder Structure

```text
src/
├── config/             # DB connection, env variables, socket configs...
├── middlewares/        # Auth, role check, input validation, error handling...
├── shared/             # Constants, custom exceptions, helpers, logger, response formatter...
├── sockets/            # Socket.IO handlers & real-time events
├── jobs/               # Scheduled cron jobs (check expirations, reminders...)
├── integrations/       # External service adapters (AI, PayOS, Maps, Mail, Storage...)
├── modules/            # Feature modules
│   ├── auth/           # Login, register, authentication
│   ├── parent/         # Parent profile management
│   ├── child/          # Child profile management
│   ├── discovery/      # Search, filter, and matching
│   ├── connection/     # Friend requests and connections
│   ├── chat/           # 1-on-1 and playdate group chat (Socket.IO)
│   ├── playdate/       # Playdates, invites, rescheduling, cancellations
│   ├── ai-assistant/   # AI assistant (Function Calling/Tools)
│   ├── subscription/   # Plans and payments (PayOS)
│   ├── notification/   # In-app and push notifications
│   ├── gamification/   # Streaks and badges
│   ├── safety/         # Reports, blocks, child safety
│   ├── rating-feedback/# Reviews and feedback after playdates
│   └── admin/          # Admin management
├── app.js
├── server.js
test/
├── globalSetup.js      # Spin up MongoMemoryServer
├── globalTeardown.js   # Stop MongoMemoryServer
├── setupFile.js        # Mongoose connection hooks
├── helpers/            # dbHelper.js, authHelper.js
├── mocks/              # payosMock.js, geminiMock.js
└── integration/        # auth.test.js, etc.
```

---

## 3. Standard Module Structure

Every folder in `modules/<name>/` follows this layout:

```text
module/
├── module.route.js        # API endpoint definitions & middlewares
├── module.controller.js   # Parse request, call service, return response
├── module.service.js      # Core business logic
├── module.repository.js   # MongoDB queries via Mongoose (CRUD)
├── module.model.js        # Mongoose Schema & Indexes
├── module.validation.js   # Input data validation schemas
├── module.dto.js          # Request/response data shaping
└── (optional: policy.js, events.js, tools/...)
```

---

## 4. Layer Responsibilities (Rules)

| Layer | DO | DON'T |
| :--- | :--- | :--- |
| **Route** | Define URLs, HTTP methods, and middlewares (auth, validation). | Do NOT put business logic here. |
| **Controller** | Read params/body, call Service, return standardized response. | Do NOT write business logic or query the DB directly. |
| **Service** | Handle all business logic, rules, calculations, and call Repository. | Do NOT access Express `req`/`res` objects directly. |
| **Repository** | Execute database operations (CRUD) using Mongoose. | Do NOT contain business logic or app rules. |
| **Model** | Define Mongoose schema, data types, constraints, and indexes. | Do NOT implement complex business workflows. |
| **Validation** | Validate request syntax, required fields, and data formats. | Do NOT run deep business checks (keep those in Service). |
| **Policy** *(optional)* | Isolate complex authorization checks (e.g. `canCancelPlaydate`). | Do NOT duplicate database access unnecessarily. |

---

## 5. Communication & Integration Rules

1. **Cross-Module Communication:**
   - Module A needs data or actions from Module B $\rightarrow$ **call Module B's Service** (never access Module B's Repository directly).
2. **External Integrations (`integrations/`):**
   - External providers (AI, PayOS, Google Maps, S3/Cloudinary, Email) must be wrapped inside adapters in `integrations/`. Services only talk to adapters.
3. **AI Assistant Tools (`ai-assistant/`):**
   - AI tools (Function Calling) **must always call Services**, never bypass them to query Repositories directly.
4. **Sockets & Real-time:**
   - Socket handlers only listen to / emit events and **call Services** to process data and business logic.
5. **Background Jobs (`jobs/`):**
   - Cron jobs (e.g., auto-complete expired playdates, check expiring subscriptions) **must call Services**.
6. **Internal Events:**
   - Use Node's built-in EventEmitter for non-blocking side effects: sending notifications, updating streaks, or awarding badges after a playdate.
7. **Centralized Error Handling:**
   - Service throws errors (`throw new AppError(...)`) $\rightarrow$ Controller passes them to `next(err)` $\rightarrow$ Error Middleware returns a clean, uniform JSON response.

---

## 6. Key Takeaways

- **Architecture:** Modular Monolith organized by feature.
- **Data Flow:** `Route → Controller → Service → Repository → Model`.
- **Golden Rule:** *Business logic stays in Services, queries stay in Repositories, Controllers only route, and external APIs are isolated in Adapters.*
