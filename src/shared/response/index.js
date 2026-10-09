export const successResponse = (res, data = null, message = "Success", statusCode = 200, meta) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    // Extra information about the result (only sent when given)
    ...(meta ? { meta } : {}),
    error: null,
  });
};

export const errorResponse = (
  res,
  message = "Error",
  statusCode = 500,
  error = {
    code: "INTERNAL_SERVER_ERROR",
    details: [],
  },
) => {
  return res.status(statusCode).json({
    success: false,
    message,
    data: null,
    error: {
      code: error?.code || "INTERNAL_SERVER_ERROR",
      details: Array.isArray(error?.details) ? error.details : [],
    },
  });
};

// Aliases for convenience
export const sendSuccess = successResponse;
export const sendError = (res, message, statusCode, code, details) =>
  errorResponse(res, message, statusCode, { code, details });
