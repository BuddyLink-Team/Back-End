import mongoose from "mongoose";
import logger from "../shared/logger/index.js";
import { errorResponse } from "../shared/response/index.js";

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

export const errorHandler = (error, _req, res, _next) => {
  let statusCode = error.statusCode || 500;
  let message = error.message || "Internal server error";
  let code = error.code || "INTERNAL_SERVER_ERROR";
  let details = error.details !== undefined && error.details !== null ? error.details : [];

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

  // Log error using pino
  logger.error({
    message,
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
