class AppError extends Error {
  constructor(message, statusCode = 500, code = "APP_ERROR", details = [], isOperational = true) {
    super(message);

    this.statusCode = statusCode;
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
