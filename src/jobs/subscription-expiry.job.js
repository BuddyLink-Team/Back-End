import cron from 'node-cron';
import env from '../config/env.js';
import logger from '../shared/logger/index.js';
import subscriptionService from '../modules/subscription/subscription.service.js';

// Every hour at minute 5 (business timezone)
const SCHEDULE = '5 * * * *';

/**
 * Periodically expire paid subscriptions past their end date and downgrade them to Free,
 * then settle expired unpaid PayOS orders (reconciled with PayOS).
 * (Reads also expire lazily in subscriptionService.getActiveSubscriptionByParentId; this job keeps
 * stored statuses accurate for admin statistics and parents who are not active.)
 * @returns {import('node-cron').ScheduledTask}
 */
export const startSubscriptionExpiryJob = () =>
  cron.schedule(
    SCHEDULE,
    async () => {
      try {
        await subscriptionService.expireDueSubscriptions();
        // Orders paid while a PayOS webhook was missed are granted here even if the parent never comes back
        await subscriptionService.reconcileStalePayments();
      } catch (error) {
        logger.error(`[SubscriptionExpiryJob] Failed: ${error.message}`);
      }
    },
    { timezone: env.APP_TIMEZONE },
  );

export default startSubscriptionExpiryJob;
