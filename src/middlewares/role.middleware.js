import AppError from "../shared/exceptions/AppError.js";

export const authorizeRoles = (...roles) => {
  return (req, _res, next) => {
    if (!req.user) {
      return next(
        new AppError("Authentication required", 401, "AUTHENTICATION_REQUIRED"),
      );
    }

    const userRole = (req.user.role || "").toUpperCase();
    const normalizedRoles = roles.map((r) => String(r).toUpperCase());

    if (!normalizedRoles.includes(userRole)) {
      return next(
        new AppError(
          "You do not have permission to perform this action",
          403,
          "INSUFFICIENT_PERMISSIONS",
        ),
      );
    }

    return next();
  };
};

export default authorizeRoles;
