import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import env from "./config/env.js";
import logger from "./shared/logger/index.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middlewares/error.middleware.js";

import authRoutes from "./modules/auth/auth.route.js";
import userRoutes from "./modules/user/user.route.js";
import parentRoutes from "./modules/parent/parent.route.js";
import childRoutes from "./modules/child/child.route.js";
import chatRoutes from "./modules/chat/chat.route.js";
import subscriptionRoutes from "./modules/subscription/subscription.route.js";
import safetyRoutes from "./modules/safety/safety.route.js";

const app = express();

// Behind a reverse proxy, trust X-Forwarded-For so req.ip (used by every rate limiter)
// is the real client IP instead of the proxy's shared IP
app.set("trust proxy", env.TRUST_PROXY);

// Security Headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
    data: null,
    error: {
      code: "TOO_MANY_REQUESTS",
      details: [],
    },
  },
});
app.use("/api", limiter);

// Request parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Request logger middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

// Root & Health Check Routes
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BuddyLink Server is running successfully!",
  });
});

// Main API V1 Routes
app.get("/api/v1", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BuddyLink API v1 is active",
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/parent", parentRoutes);
app.use("/api/v1/children", childRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/subscriptions", subscriptionRoutes);
app.use("/api/v1/safety", safetyRoutes);

// Catch 404 Not Found
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

export default app;
