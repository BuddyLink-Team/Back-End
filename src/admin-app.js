import express from "express";
import cors from "cors";
import helmet from "helmet";
import env from "./config/env.js";
import logger from "./shared/logger/index.js";
import { successResponse } from "./shared/response/index.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware.js";
import { apiLimiter } from "./middlewares/rate-limit.middleware.js";
import { TOKEN_AUDIENCES } from "./modules/auth/auth.constants.js";

import adminRoutes from "./modules/admin/admin.route.js";

/**
 * Admin portal API: served on its own port (ADMIN_PORT) locally and as its own service in production.
 * Only admin routes are mounted here, and only admin-portal tokens are accepted.
 */
const adminApp = express();

adminApp.set("trust proxy", env.TRUST_PROXY);

// Read by authenticate/refresh to reject tokens issued for the parent app
adminApp.set("tokenAudience", TOKEN_AUDIENCES.ADMIN);

// Security Headers
adminApp.use(helmet());

// CORS: only the admin frontend
adminApp.use(
  cors({
    origin: env.ADMIN_CLIENT_URL,
    credentials: true,
  }),
);

// Rate Limiting
adminApp.use("/api", apiLimiter);

// Request parsing
adminApp.use(express.json({ limit: "10mb" }));
adminApp.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logger middleware
adminApp.use((req, res, next) => {
  logger.info(`[admin] ${req.method} ${req.originalUrl}`);
  next();
});

adminApp.get("/api/v1/admin", (req, res) => successResponse(res, null, "BuddyLink Admin API v1 is active"));

adminApp.use("/api/v1/admin", adminRoutes);

// Catch 404 Not Found
adminApp.use(notFoundHandler);

// Centralized Error Handling Middleware
adminApp.use(errorHandler);

export default adminApp;
