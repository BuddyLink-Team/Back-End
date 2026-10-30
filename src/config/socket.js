import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import env from './env.js';
import logger from '../shared/logger/index.js';
import registerChatSocket from '../sockets/chat.socket.js';
import parentService from '../modules/parent/parent.service.js';
import userService from '../modules/user/user.service.js';
import { USER_ROLES } from '../shared/constants/index.js';
import { ADMIN_SOCKET_NAMESPACE, ADMIN_SOCKET_ROOM } from '../modules/admin/admin.constants.js';
import { TOKEN_AUDIENCES } from '../modules/auth/auth.constants.js';
import { getTokenAudience } from '../shared/helpers/token.helper.js';

let io = null;
let adminIo = null;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
  });

  // Socket Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const rawToken = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      if (!rawToken) {
        return next(new Error('Authentication error: Token required'));
      }

      const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
      const secret = env.JWT.SECRET || process.env.JWT_SECRET;
      if (!secret) {
        return next(new Error('Authentication error: Server JWT secret misconfigured'));
      }

      const decoded = jwt.verify(token, secret);
      // Realtime is part of the parent app only: admin portal tokens are rejected
      if (getTokenAudience(decoded) !== TOKEN_AUDIENCES.APP) {
        return next(new Error('Authentication error: Invalid token'));
      }
      const userId = decoded.sub || decoded.id;

      // Verify user existence, active status, and non-deleted
      const user = await userService.getSessionUser(userId);
      if (!user) {
        return next(new Error('Authentication error: User not found or deleted'));
      }

      if (!user.isActive) {
        return next(new Error('Authentication error: Account disabled'));
      }

      socket.userId = user._id.toString();
      socket.user = user;

      const parent = await parentService.getParentByUserId(userId);
      if (parent) {
        socket.parentId = parent._id.toString();
        socket.parent = parent;
      }

      return next();
    } catch (err) {
      logger.warn(`Socket auth rejected: ${err.message}`);
      return next(new Error(`Authentication error: ${err.message}`));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (User: ${socket.userId || 'anon'}, Parent: ${socket.parentId || 'anon'})`);

    // Join personal user and parent rooms for targeted events
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }
    if (socket.parentId) {
      socket.join(`parent:${socket.parentId}`);
    }

    // Register Chat Event Handlers
    registerChatSocket(io, socket);

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Only admin portal tokens of an active admin may join the /admin namespace
 */
export const authenticateAdminSocket = async (socket, next) => {
  try {
    const rawToken = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    if (!rawToken) {
      return next(new Error('Authentication error: Token required'));
    }

    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
    const decoded = jwt.verify(token, env.JWT.SECRET);
    if (getTokenAudience(decoded) !== TOKEN_AUDIENCES.ADMIN) {
      return next(new Error('Authentication error: Invalid admin token'));
    }

    const user = await userService.getSessionUser(decoded.sub || decoded.id);
    if (!user) {
      return next(new Error('Authentication error: User not found or deleted'));
    }
    if (!user.isActive) {
      return next(new Error('Authentication error: Account disabled'));
    }
    if (user.role !== USER_ROLES.ADMIN) {
      return next(new Error('Authentication error: Admin access required'));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    return next();
  } catch (err) {
    logger.warn(`Admin socket auth rejected: ${err.message}`);
    return next(new Error(`Authentication error: ${err.message}`));
  }
};

/**
 * Socket.io of the admin portal, on the HTTP server of the admin API: it has the admin JWT secret
 * and allows the admin frontend. Only the /admin namespace is used.
 */
export const initAdminSocket = (httpServer) => {
  adminIo = new Server(httpServer, {
    cors: {
      origin: env.ADMIN_CLIENT_URL,
      credentials: true,
    },
  });

  const adminNamespace = adminIo.of(ADMIN_SOCKET_NAMESPACE);

  adminNamespace.use(authenticateAdminSocket);

  adminNamespace.on('connection', (socket) => {
    logger.info(`Admin socket connected: ${socket.id} (Admin: ${socket.userId})`);

    // Admins join the dedicated room
    socket.join(ADMIN_SOCKET_ROOM);

    socket.on('disconnect', () => {
      logger.info(`Admin socket disconnected: ${socket.id}`);
    });
  });

  return adminIo;
};

export const getIO = () => {
  return io || null;
};

export const getAdminIO = () => {
  return adminIo ? adminIo.of(ADMIN_SOCKET_NAMESPACE) : null;
};
