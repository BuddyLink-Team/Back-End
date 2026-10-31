import http from 'http';
import adminApp from './admin-app.js';
import env from './config/env.js';
import connectDatabase from './config/database.js';
import { initAdminSocket } from './config/socket.js';
import adminNotificationService from './modules/admin/admin-notification.service.js';
import logger from './shared/logger/index.js';

/**
 * Standalone admin API (e.g. its own Render service): listens on PORT, which the host provides.
 * Locally, `npm run dev` already serves the admin API on ADMIN_PORT next to the parent API.
 * Background jobs only run in the parent API (src/server.js). Socket.io here only serves the /admin namespace.
 */
const startAdminServer = async () => {
  try {
    await connectDatabase();

    const server = http.createServer(adminApp);
    initAdminSocket(server);
    adminNotificationService.startRealtimeBroadcast();

    server.listen(env.PORT, () => {
      logger.info(`BuddyLink admin server running in ${env.NODE_ENV} mode at http://localhost:${env.PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start admin server: ${error.message}`);
    process.exit(1);
  }
};

startAdminServer();
