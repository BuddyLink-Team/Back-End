import http from 'http';
import app from './app.js';
import env from './config/env.js';
import connectDatabase from './config/database.js';
import { initSocket } from './config/socket.js';
import logger from './shared/logger/index.js';
import subscriptionService from './modules/subscription/subscription.service.js';
import userService from './modules/user/user.service.js';
import { startSubscriptionExpiryJob } from './jobs/subscription-expiry.job.js';
import mailAdapter from './integrations/mail/mail.adapter.js';

const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

const startServer = async () => {
  try {
    // 1. Connect MongoDB
    await connectDatabase();

    // 2. Seed Default Subscription Plans if not present
    await subscriptionService.seedSubscriptionPlans();

    // 3. Migrate legacy upper-case roles ("PARENT"/"ADMIN") to the lower-case values in the schema
    await userService.normalizeLegacyRoles();

    // 4. Expire past-due paid plans now, then keep doing it on a schedule
    await subscriptionService.expireDueSubscriptions();
    startSubscriptionExpiryJob();

    // Not awaited: only reports SMTP problems in the logs, never blocks startup
    mailAdapter.verifyConnection();

    // 5. Start HTTP Server
    server.listen(env.PORT, () => {
      logger.info(`BuddyLink server running in ${env.NODE_ENV} mode at http://localhost:${env.PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
