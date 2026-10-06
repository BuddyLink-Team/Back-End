import crypto from "crypto";
import jwt from "jsonwebtoken";
import env from "../../config/env.js";
import AppError from "../exceptions/AppError.js";
import { AUTH_COOKIE_NAMES, TOKEN_TYPES } from "../../modules/auth/auth.constants.js";

const parseExpiresInToMs = (value, fallbackMs) => {
  if (!value) return fallbackMs;

  if (typeof value === "number") return value * 1000;

  const match = String(value).trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
};

export const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

export const getAccessTokenExpiresIn = () => {
  return env.JWT.ACCESS_EXPIRES_IN || process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
};

export const getRefreshTokenExpiresIn = () => {
  return env.JWT.REFRESH_EXPIRES_IN || process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
};

export const getAccessTokenMaxAge = () => {
  return parseExpiresInToMs(getAccessTokenExpiresIn(), 15 * 60 * 1000);
};

export const getRefreshTokenMaxAge = () => {
  return parseExpiresInToMs(getRefreshTokenExpiresIn(), 7 * 24 * 60 * 60 * 1000);
};

export const createAccessToken = (user) => {
  const secret = env.JWT.SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError("Missing JWT_SECRET in environment variables", 500, "SERVER_CONFIGURATION_ERROR");
  }

  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      type: TOKEN_TYPES.ACCESS,
    },
    secret,
    {
      expiresIn: getAccessTokenExpiresIn(),
    },
  );
};

export const createRefreshTokenValue = (user) => {
  const secret = env.JWT.REFRESH_SECRET || process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new AppError("Missing JWT_REFRESH_SECRET in environment variables", 500, "SERVER_CONFIGURATION_ERROR");
  }

  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      type: TOKEN_TYPES.REFRESH,
      jti: crypto.randomUUID(),
    },
    secret,
    {
      expiresIn: getRefreshTokenExpiresIn(),
    },
  );
};

/**
 * Clear auth cookies set by earlier versions (tokens are now returned in the JSON body).
 */
export const clearAuthCookies = (res) => {
  res.clearCookie(AUTH_COOKIE_NAMES.REFRESH_TOKEN, { path: "/api/v1/auth" });
  res.clearCookie(AUTH_COOKIE_NAMES.REFRESH_TOKEN, { path: "/" });
  res.clearCookie(AUTH_COOKIE_NAMES.ACCESS_TOKEN, { path: "/" });
};

export const getBearerToken = (req) => {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.split(" ")[1];
};

// Access tokens are accepted only from the Authorization header
export const getAccessTokenFromRequest = (req) => getBearerToken(req);

export const getRefreshTokenFromRequest = (req) => {
  return req.body?.refreshToken || null;
};
