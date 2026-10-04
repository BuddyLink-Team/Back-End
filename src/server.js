import http from 'http';
import app from './app.js';
import env from './config/env.js';
import connectDatabase from './config/database.js';
import { initSocket } from './config/socket.js';
import logger from './shared/logger/index.js';
import subscriptionService from './modules/subscription/subscription.service.js';

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
    server.listen(env.PORT, () => {
      logger.info(`BuddyLink server running in ${env.NODE_ENV} mode at http://localhost:${env.PORT}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();
