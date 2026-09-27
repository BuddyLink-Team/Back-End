import jwt from "jsonwebtoken";
import env from "../config/env.js";
import User from "../modules/user/user.model.js";
import AppError from "../shared/exceptions/AppError.js";
import { getAccessTokenFromRequest } from "../shared/helpers/token.helper.js";
import { TOKEN_TYPES } from "../modules/auth/auth.constants.js";

export const authenticate = async (req, _res, next) => {
  try {
    const token = getAccessTokenFromRequest(req);

    if (!token) {
      throw new AppError(
        "Authentication required",
        401,
        "AUTHENTICATION_REQUIRED",
      );
    }

    const jwtSecret = env.JWT.SECRET || process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError(
        "Missing JWT_SECRET in environment variables",
        500,
        "SERVER_CONFIGURATION_ERROR",
      );
    }

    const decoded = jwt.verify(token, jwtSecret);

    if (decoded.type && decoded.type !== TOKEN_TYPES.ACCESS) {
      throw new AppError("Invalid access token", 401, "INVALID_ACCESS_TOKEN");
    }

    const user = await User.findOne({
      _id: decoded.sub || decoded.id,
      deletedAt: null,
    }).select("-passwordHash");

    if (!user) {
      throw new AppError("User not found", 401, "USER_NOT_FOUND");
    }

    if (!user.isActive) {
      throw new AppError("User account is disabled", 403, "ACCOUNT_DISABLED");
    }

    req.user = user;
    req.userId = user._id.toString();

    return next();
  } catch (error) {
    if (error instanceof AppError) return next(error);

    if (error.name === "TokenExpiredError") {
      return next(
        new AppError("Access token expired", 401, "ACCESS_TOKEN_EXPIRED"),
      );
    }

    if (error.name === "JsonWebTokenError") {
      return next(
        new AppError("Invalid access token", 401, "INVALID_ACCESS_TOKEN"),
      );
    }

    return next(error);
  }
};

export default authenticate;
