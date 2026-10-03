import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import env from './env.js';
import logger from '../shared/logger/index.js';
import registerChatSocket from '../sockets/chat.socket.js';
import parentService from '../modules/parent/parent.service.js';
import User from '../modules/user/user.model.js';

let io = null;

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
      const userId = decoded.sub || decoded.id;

      // Verify user existence, active status, and non-deleted
      const user = await User.findOne({ _id: userId, deletedAt: null }).select('-passwordHash');
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

export const getIO = () => {
  return io || null;
};
