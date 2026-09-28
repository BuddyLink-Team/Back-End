# BUDDYLINK AI AGENT GUIDE (CODE GENERATION SPEC)

IMPORTANT:
This file is NOT documentation for humans.
This is a STRICT EXECUTION SPEC for AI CODE GENERATION AGENTS.

Any ambiguity MUST be resolved by following the rules below.

---

# 1. ROLE DEFINITION

AI Agent role:

You are a BACKEND CODE GENERATOR for the BuddyLink Node.js + Express + MongoDB system.

You MUST generate:

- controllers
- services
- repositories
- models
- routes

You MUST NOT:

- change business requirements
- invent new features
- modify architecture rules

---

# 2. SYSTEM ARCHITECTURE (NON-NEGOTIABLE)

ALL modules MUST follow:

Route → Controller → Service → Repository → Model

No shortcuts allowed.

---

# 3. MODULE GENERATION RULE

Each module MUST be generated under `src/modules/<module-name>/` as:

```text
module/
├── module.route.js
├── module.controller.js
├── module.service.js
├── module.repository.js
├── module.model.js
├── module.validation.js
└── module.dto.js
```

Optional (when required by feature):

- `module.policy.js` (complex permission checks)
- `module.events.js` (event listeners/emitters)
- `tools/` (AI Function Calling tools for `ai-assistant`)

---

# 4. SERVICE RULE (CRITICAL)

All business logic MUST be inside Service layer ONLY.

Service responsibilities:

- validation (business rules)
- computation & matching algorithms
- orchestration of repositories & other services
- calling external adapters (`src/integrations/`)

Service MUST NOT:

- handle HTTP request/response
- directly access `req`/`res`
- query MongoDB directly (must call Repository)

---

# 5. CONTROLLER RULE

Controller MUST:

- receive `req` (params, query, body, user)
- call service
- return response using response formatter helper
- pass unhandled errors to `next(err)`

Controller MUST NOT:

- contain business logic
- query database directly
- call external APIs directly

---

# 6. REPOSITORY RULE

Repository MUST:

- only interact with MongoDB (Mongoose)
- perform data access operations (CRUD, aggregates)
- return plain objects/documents to Service
- have no business logic

---

# 7. MODEL RULE

Model MUST:

- define Mongoose schema & indexes only
- include `timestamps: true`
- include soft delete fields when applicable

Required common fields:

- `createdAt`
- `updatedAt`
- `deletedAt` (nullable / default null)
- `isActive` (boolean / default true)

---

# 8. API RESPONSE FORMAT (MANDATORY)

ALL responses MUST follow:

SUCCESS:

```json
{
  "success": true,
  "message": "string",
  "data": {},
  "error": null
}
```

ERROR:

```json
{
  "success": false,
  "message": "string",
  "data": null,
  "error": {
    "code": "string",
    "details": []
  }
}
```

---

# 9. ERROR HANDLING RULE

ALL operational errors MUST use:

`AppError(message, statusCode, code, details, isOperational)`

NEVER:

- `throw "string"`
- `throw new Error(...)` without standard status/code
- handle errors inconsistently across controllers

---

# 10. AUTH & ROLE RULE

BuddyLink has two main roles:

- `PARENT`
- `ADMIN`

If module requires authentication:

- MUST use `auth.middleware.js` (authenticate)

If role restriction required:

- MUST use `role.middleware.js` (e.g. `authorizeRoles('PARENT')`, `authorizeRoles('ADMIN')`)

---

# 11. CROSS-MODULE & INTEGRATION RULES

- **Cross-module:** Always call another module's Service, NEVER access another module's Repository.
- **External Services:** Mọi tích hợp bên ngoài (AI Gemini, PayOS, Cloudinary/Storage, Google Maps, Nodemailer) MUST reside in `src/integrations/` as adapters.
- **AI Tools:** AI Function Calling tools in `ai-assistant/tools/` MUST call domain services, never bypass them.
- **Realtime (Sockets):** Socket handlers MUST call Services to execute business operations.

---

# 12. MODULE SYSTEM & SYNTAX RULES

- **Module System:** STRICTLY use **ES Modules (ESM)** (`import` / `export`). NEVER use CommonJS (`require` / `module.exports`).
- **Imports:** Always specify file extensions explicitly in relative imports (e.g., `import env from './env.js';`).
- **Files & Folders:** `kebab-case` (e.g. `ai-assistant.service.js`, `playdate.controller.js`)
- **Variables & Functions:** `camelCase` (e.g. `findMatches`, `createPlaydate`)
- **Classes & Models:** `PascalCase` (e.g. `PlaydateService`, `ChildModel`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g. `PLAYDATE_STATUS`, `USER_ROLES`)
- **Code Comments:** STRICTLY write all code comments, docstrings, and notes in **English only**. Never write Vietnamese comments in code.

---

# 13. AI BEHAVIOR RULE

If requirement is unclear:
→ choose simplest implementation that satisfies architecture

If multiple solutions exist:
→ prefer service-layer solution

If performance vs clarity conflict:
→ choose clarity
