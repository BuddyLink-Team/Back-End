import { validationResult } from "express-validator";
import AppError from "../shared/exceptions/AppError.js";

export const validateRequest = (req, _res, next) => {
  const result = validationResult(req);

  if (result.isEmpty()) {
    return next();
  }

  const details = result.array().map((error) => ({
    field: error.path || error.param,
    message: error.msg,
  }));

  const message = details.map((error) => error.message).join("; ");

  return next(new AppError(message || "Validation failed", 400, "VALIDATION_ERROR", details));
};

export const validate = (validations) => {
  return async (req, res, next) => {
    for (const validation of validations) {
      const result = await validation.run(req);
      if (result.errors.length) break;
    }
    return validateRequest(req, res, next);
  };
};

export default validate;
