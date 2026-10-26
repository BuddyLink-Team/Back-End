import { Router } from 'express';
import authController from '../auth/auth.controller.js';
import userRoutes from '../user/user.route.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { adminLoginLimiter } from '../../middlewares/rate-limit.middleware.js';
import { loginValidation, refreshTokenValidation } from '../auth/auth.validation.js';
import { USER_ROLES } from '../../shared/constants/index.js';

import adminController from './admin.controller.js';
import {
  adminGetPlaydatesValidation,
  adminCancelPlaydateValidation,
  adminGetConnectionsValidation,
  adminDeleteConnectionValidation,
  mongoIdParamValidation,
} from './admin.validation.js';

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

// Playdates oversight
router.get('/playdates', validate(adminGetPlaydatesValidation), adminController.getPlaydates);
router.get('/playdates/:id', validate(mongoIdParamValidation), adminController.getPlaydateDetail);
router.patch('/playdates/:id/cancel', validate(adminCancelPlaydateValidation), adminController.cancelPlaydate);

// Connections oversight
router.get('/connections', validate(adminGetConnectionsValidation), adminController.getConnections);
router.get('/connections/:id', validate(mongoIdParamValidation), adminController.getConnectionDetail);
router.delete('/connections/:id', validate(adminDeleteConnectionValidation), adminController.removeConnection);

export default router;
