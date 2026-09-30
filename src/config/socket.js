import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import env from './env.js';
import logger from '../shared/logger/index.js';
import registerChatSocket from '../sockets/chat.socket.js';
import parentService from '../modules/parent/parent.service.js';

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
        return next();
      }

      const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
      const secret = env.JWT.SECRET || process.env.JWT_SECRET;
      const decoded = jwt.verify(token, secret);

      const userId = decoded.sub || decoded.id;
      socket.userId = userId;

      const parent = await parentService.getParentByUserId(userId);
      if (parent) {
        socket.parentId = parent._id.toString();
      }

      return next();
    } catch (err) {
      logger.warn(`Socket auth warning: ${err.message}`);
      return next();
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (User: ${socket.userId || 'anon'}, Parent: ${socket.parentId || 'anon'})`);

    // Register Chat Event Handlers
    registerChatSocket(io, socket);

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io is not initialized yet');
  }
  return io;
};
