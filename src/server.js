import http from 'http';
import app from './app.js';
import env from './config/env.js';
import connectDatabase from './config/database.js';
import { initSocket } from './config/socket.js';
import logger from './shared/logger/index.js';
import subscriptionService from './modules/subscription/subscription.service.js';
import userService from './modules/user/user.service.js';
import placesService from './modules/places/places.service.js';
import { startSubscriptionExpiryJob } from './jobs/subscription-expiry.job.js';
import { startPlaydateAutoCloseJob, runPlaydateAutoClose } from './jobs/playdate-auto-close.job.js';
import mailAdapter from './integrations/mail/mail.adapter.js';

import { seedBadges } from './modules/gamification/gamification.service.js';
import { startGamificationJob, runGamificationJob } from './modules/gamification/gamification.job.js';

import UserBadge from './modules/gamification/user-badge.model.js';
import RatingFeedback from './modules/rating-feedback/rating-feedback.model.js';

const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

const startServer = async () => {
  try {
    // 1. Connect MongoDB
    await connectDatabase();

    // 2. Seed Default Subscription Plans if not present
    await subscriptionService.seedSubscriptionPlans();

    await Promise.all([UserBadge.init(), RatingFeedback.init()]);
    await seedBadges();
    startGamificationJob();
    // Catch up after downtime without delaying HTTP startup.
    void runGamificationJob();

    // 3. Start HTTP Server
    // 2b. Places cache indexes (legacy googlePlaceId index is dropped)
    await placesService.ensureIndexes();

    // 3. Migrate legacy upper-case roles ("PARENT"/"ADMIN") to the lower-case values in the schema
    await userService.normalizeLegacyRoles();

    // 4. Expire past-due paid plans now, then keep doing it on a schedule
    await subscriptionService.expireDueSubscriptions();
    startSubscriptionExpiryJob();

    // Close the playdates of past days now (in case the server was down at midnight), then daily at 00:00
    await runPlaydateAutoClose();
    startPlaydateAutoCloseJob();

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
