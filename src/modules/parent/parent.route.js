import { Router } from 'express';
import parentController from './parent.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { uploadAvatar } from '../../middlewares/upload.middleware.js';
import {
  onboardingPreferencesValidation,
  updateParentProfileValidation,
} from './parent.validation.js';
import { USER_ROLES } from '../../shared/constants/index.js';

const router = Router();

// Routes for authenticated parents
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT));

// Profile view & update
router.get('/me', parentController.getMyProfile);
router.put('/me', validate(updateParentProfileValidation), parentController.updateProfile);

// Avatar update
router.patch('/me/avatar', uploadAvatar, parentController.updateAvatar);

// Onboarding preferences
router.put(
  '/preferences/onboarding',
  validate(onboardingPreferencesValidation),
  parentController.updateOnboardingPreferences
);

export default router;
