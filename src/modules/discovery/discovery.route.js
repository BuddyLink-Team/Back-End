import { Router } from 'express';
import discoveryController from './discovery.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import {
  discoveryQueryValidation,
  swipeValidation,
} from './discovery.validation.js';
import { USER_ROLES } from '../../shared/constants/index.js';

const router = Router();

// All discovery routes require authenticated parent
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT));

// GET /api/v1/discovery — Retrieve discovery profiles with Smart Matching
router.get('/', validate(discoveryQueryValidation), discoveryController.getDiscoveryProfiles);

// POST /api/v1/discovery/swipe — Record a swipe action (Like/Pass)
router.post('/swipe', validate(swipeValidation), discoveryController.swipeProfile);

export default router;
