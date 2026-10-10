import mongoose from "mongoose";
import logger from "../shared/logger/index.js";
import { errorResponse } from "../shared/response/index.js";
import AppError from "../shared/exceptions/AppError.js";

export const notFoundHandler = (req, res) => {
  return errorResponse(res, `Route not found: ${req.method} ${req.originalUrl}`, 404, {
    code: "ROUTE_NOT_FOUND",
    details: [
      {
        method: req.method,
        path: req.originalUrl,
      },
    ],
  });
};

const INTERNAL_ERROR_MESSAGE = "Internal server error";

/**
 * Errors whose message is safe to show to clients: our AppError (operational) and
 * client errors raised by Express/body-parser (e.g. malformed JSON, payload too large)
 */
const isClientSafeError = (error) =>
  error instanceof AppError ||
  error.isOperational === true ||
  (error.expose === true && (error.statusCode || error.status) < 500);

export const errorHandler = (error, _req, res, _next) => {
  const isSafe = isClientSafeError(error);
  let statusCode = error.statusCode || error.status || 500;
  let message = isSafe ? error.message || INTERNAL_ERROR_MESSAGE : INTERNAL_ERROR_MESSAGE;
  let code = isSafe && typeof error.code === "string"
    ? error.code
    : statusCode < 500 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
  // Details may be an object (e.g. QUOTA_EXCEEDED: { feature, limit, resetAt } read by the paywall)
  let details = isSafe && error.details !== undefined && error.details !== null ? error.details : [];

  // Unknown errors (programming bugs, DB/network failures) never leak their message or details
  if (!isSafe) {
    statusCode = statusCode < 500 ? statusCode : 500;
  }

  // Mongoose duplicate key error (code 11000)
  if (error.code === 11000) {
    statusCode = 409;
    const duplicateField = Object.keys(error.keyPattern || {})[0] || "field";
    message = `${duplicateField} already exists`;
    code = "DUPLICATE_FIELD";
    details = [
      {
        field: duplicateField,
        message,
      },
    ];
  }

  // Mongoose invalid ObjectId error
  if (error instanceof mongoose.Error.CastError) {
    statusCode = 400;
    message = "Invalid resource id";
    code = "INVALID_RESOURCE_ID";
    details = [
      {
        field: error.path || "id",
        message,
      },
    ];
  }

  // Mongoose schema validation error
  if (error instanceof mongoose.Error.ValidationError) {
    statusCode = 400;
    message = Object.values(error.errors)
      .map((item) => item.message)
      .join("; ");
    code = "DATABASE_VALIDATION_ERROR";
    details = Object.values(error.errors).map((item) => ({
      field: item.path,
      message: item.message,
    }));
  }

  // Log the original error (the client only receives the sanitized message above)
  logger.error({
    message: error.message,
    clientMessage: message,
    code,
    statusCode,
    details,
    stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
  });

  return errorResponse(res, message, statusCode, {
    code,
    details,
  });
};

export default errorHandler;
