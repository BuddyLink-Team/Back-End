import { Router } from 'express';
import parentController from './parent.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { onboardingPreferencesValidation } from './parent.validation.js';
import { USER_ROLES } from '../../shared/constants/index.js';

const router = Router();

// Routes for authenticated parents
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT, 'PARENT', 'parent'));

router.get('/me', parentController.getMyProfile);
router.put(
  '/preferences/onboarding',
  validate(onboardingPreferencesValidation),
  parentController.updateOnboardingPreferences
);

export default router;
