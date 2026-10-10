# BuddyLink Backend Git Rules & Workflow

This document establishes the mandatory Git workflow, branch naming strategy, commit message standards, database migration rules, and pull request procedures for the **BuddyLink Backend** repository.

---

## 🌿 1. Branch Strategy

All development branches are created directly from the primary branch: **`main`**.

### Branch Hierarchy

```text
main (Primary production & integration branch, protected)
  ▲
  │ (Pull Request after tests pass & code review)
feature/BUD-201-auth-otp-verification
fix/BUD-202-playdate-reschedule-status-bug
refactor/BUD-203-modular-monolith-directory
```

### Branch Naming Conventions

Use lowercase letters, numbers, and hyphens (`-`). Prefix each branch with its intent and the project ticket code **`BUD-<number>`**:

| Prefix | Use Case | Example |
| :--- | :--- | :--- |
| `feature/` | Developing a new domain feature, API endpoint, or socket event | `feature/BUD-201-payos-payment-webhook`<br>`feature/BUD-31-smart-matching-algorithm` |
| `fix/` | Resolving an API bug, status transition defect, or validation error | `fix/BUD-202-jwt-refresh-token`<br>`fix/BUD-44-chat-socket-disconnect` |
| `refactor/` | Internal restructuring without changing external API responses | `refactor/BUD-203-modular-monolith`<br>`refactor/BUD-55-centralized-error-middleware` |
| `security/` | Security patches, dependency vulnerability fixes, rate limiting | `security/BUD-66-bcrypt-salt-rounds` |
| `docs/` | Updating architecture docs, API schemas, DATABASE_SCHEMA.md | `docs/BUD-88-sync-backend-architecture` |
| `test/` | Adding integration, unit, or mock test coverage | `test/BUD-92-auth-integration-flow` |
| `hotfix/` | Urgent fixes pushed directly to `main` | `hotfix/BUD-99-mongo-connection-leak` |

---

## ✍️ 2. Conventional Commit Standards

Every commit message MUST follow the **Conventional Commits** specification:

```text
<type>(<scope>): <short description in imperative mood>

[optional body with details/rationale]

[optional footer(s), e.g., Closes #123, BREAKING CHANGE]
```

### Allowed Types

- **`feat`**: A new API endpoint, socket event, or background job (e.g. `feat(playdate): implement reschedule acceptance workflow`).
- **`fix`**: A bug fix (e.g. `fix(auth): correct token expiry calculation in refresh service`).
- **`refactor`**: Code changes that neither fix a bug nor add a feature (e.g. `refactor(shared): centralize AppError and status codes`).
- **`perf`**: A code change that improves query performance or reduces memory usage (e.g. `perf(discovery): add compound geo index on parent coordinates`).
- **`docs`**: Documentation only changes (e.g. `docs(api): document PayOS webhook payload specification`).
- **`test`**: Adding missing tests or correcting existing tests.
- **`chore`**: Build scripts, npm packages, Docker or tool configurations.

### Permitted Backend Scopes

| Scope | Description |
| :--- | :--- |
| `auth` | Register, Login, Refresh token, OTP verification |
| `user` | User settings, password update |
| `parent` | Parent profile, identity verification |
| `child` | Child profile CRUD, interest tags |
| `discovery` | Peer finding, matchmaking score calculation |
| `connection` | Connection requests, accept/decline, block |
| `playdate` | Playdate lifecycle, scheduling, reschedule requests |
| `chat` | 1-1 conversation, playdate group messaging |
| `socket` | Socket.io server connection, rooms, events |
| `ai` | AI Assistant agent service, tool-calling handlers |
| `safety` | Account report moderation, user blocking |
| `gamification` | Weekly streaks, badge unlocks |
| `subscription` | Membership plans, PayOS webhook checkout |
| `admin` | Admin dashboard statistics, user management |
| `db` | Mongoose models, schemas, indexes |
| `middleware` | Auth, role, request validation, error handlers |
| `config` | Environment variables, database connection |

### Commit Examples

✅ **Good Commits**:
- `feat(auth): add phone OTP verification endpoint with rate limiter`
- `fix(playdate): enforce all participants accepted before confirming reschedule`
- `refactor(backend): restructure modular monolith architecture and middleware`
- `docs(db): sync child and playdate schemas with DATABASE_SCHEMA.md`
- `test(connection): add integration tests for block user flow`

❌ **Bad Commits**:
- `update server.js` *(unclear intent, missing type/scope)*
- `fix bug` *(what bug? which domain?)*
- `WIP backend` *(never push incomplete work to shared branches)*
- `fixed error in playdate` *(past tense, non-conventional)*

---

## 🛡️ 3. Pre-Commit Verification Checklist

Before running `git commit`, each developer must guarantee:

1. **Tests pass clean**:
   ```bash
   npm test
   ```
2. **Linting & Code Quality**:
   ```bash
   npm run lint
   ```
3. **No secrets or `.env` checked in**:
   - Verify `git status` does **not** stage `.env`, database passwords, or JWT secrets.
   - Keep `.env.example` updated with mock placeholders.
4. **Database Migration & Schema Sync**:
   - Any schema changes made in `src/modules/*/models/` must be reflected in `docs/DATABASE_SCHEMA.md`.
5. **No leftover debug artifacts**:
   - Remove `console.log(...)`, hardcoded mock data, or commented-out blocks.

---

## 🔀 4. Pull Request (PR) & Code Review Guidelines

1. **Title**: Follow conventional commit syntax (e.g., `feat(playdate): add reschedule negotiation flow`).
2. **Description Template**:
   - **Summary**: Key endpoints added/modified, status code changes, error scenarios.
   - **Database Changes**: New collections, fields, indexes, or breaking schema migrations.
   - **Testing Performed**: Postman/cURL test results or automated test coverage screenshots.
3. **Review Requirements**:
   - Minimum **1 approving review** from a peer backend engineer.
   - All automated test suites must pass.
4. **Merge Method**:
   - **Squash and Merge** (preferred for feature branches to keep `develop` history clean).

---

## 🚨 5. Golden Rules for Backend Developers

- **Never force push (`git push --force`)** to `main`.
- **Never commit production credentials**: Mongo URI passwords, JWT private keys, PayOS API keys, Google Cloud secrets.
- **Never bypass layer boundaries**: Routers only call Controllers/Services; never write inline Mongoose queries in route definitions.
- **Pull with rebase**: Before opening a PR or merging, pull latest `main` with:
  ```bash
  git pull --rebase origin main
  ```
