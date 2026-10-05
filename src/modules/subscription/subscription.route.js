import { Router } from 'express';
import subscriptionController from './subscription.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';

const router = Router();

// Public / Authenticated route to view available subscription plans
router.get('/plans', subscriptionController.getActivePlans);

// Parent authenticated routes
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT));

// Get current parent subscription & usage quota
router.get('/my', subscriptionController.getMySubscriptionQuota);

export default router;
