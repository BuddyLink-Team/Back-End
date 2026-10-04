import http from 'http';
import app from './app.js';
import env from './config/env.js';
import connectDatabase from './config/database.js';
import { initSocket } from './config/socket.js';
import placesService from './modules/discovery/places.service.js';
import logger from './shared/logger/index.js';

const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

const startServer = async () => {
  try {
    // 1. Connect MongoDB
    await connectDatabase();

    // 2. Seed places cache on startup if empty
    await placesService.initPlacesSeed();

    // 3. Start HTTP Server
    server.listen(env.PORT, () => {
      logger.info(`BuddyLink server running in ${env.NODE_ENV} mode at http://localhost:${env.PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
