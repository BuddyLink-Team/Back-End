import { Router } from 'express';
import authController from '../auth/auth.controller.js';
import userRoutes from '../user/user.route.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { adminLoginLimiter } from '../../middlewares/rate-limit.middleware.js';
import { loginValidation, refreshTokenValidation } from '../auth/auth.validation.js';
import { USER_ROLES } from '../../shared/constants/index.js';

const router = Router();

// Public admin auth routes (tokens issued here only work on the admin portal)
router.post('/auth/login', adminLoginLimiter, validate(loginValidation), authController.loginAdmin);
router.post('/auth/refresh-token', validate(refreshTokenValidation), authController.refreshToken);
router.post('/auth/logout', authController.logout);

// Everything below requires an admin session
router.use(authenticate, authorizeRoles(USER_ROLES.ADMIN));

router.get('/auth/me', authController.getMe);

// Own profile & password
router.use('/user', userRoutes);

export default router;
