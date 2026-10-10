import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import gamificationController from './gamification.controller.js';

const router = Router();

router.use(authenticate, authorizeRoles(USER_ROLES.PARENT));

router.get('/', gamificationController.getMyAchievements);

export default router;
