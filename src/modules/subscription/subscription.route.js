import { Router } from 'express';
import subscriptionController from './subscription.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import {
  checkoutValidation,
  verifyPaymentValidation,
  historyQueryValidation,
} from './subscription.validation.js';

const router = Router();

// Public routes
// 1. View available subscription plans
router.get('/plans', subscriptionController.getActivePlans);

// 2. PayOS IPN Webhook endpoint
router.post('/webhook', subscriptionController.handleWebhook);

// Parent authenticated routes
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT));

// Get current parent subscription & usage quota
router.get('/my', subscriptionController.getMySubscriptionQuota);

// Create PayOS checkout payment session
router.post(
  '/checkout',
  validate(checkoutValidation),
  subscriptionController.createCheckout
);

// Verify and reconcile payment status by orderCode
router.get(
  '/payments/verify/:orderCode',
  validate(verifyPaymentValidation),
  subscriptionController.verifyPayment
);

// Get paginated transaction history
router.get(
  '/payments/history',
  validate(historyQueryValidation),
  subscriptionController.getPaymentHistory
);

export default router;
