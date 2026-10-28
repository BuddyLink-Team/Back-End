import { Router } from 'express';
import authController from '../auth/auth.controller.js';
import adminController from './admin.controller.js';
import userRoutes from '../user/user.route.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { adminLoginLimiter } from '../../middlewares/rate-limit.middleware.js';
import { loginValidation, refreshTokenValidation } from '../auth/auth.validation.js';
import {
  listUsersValidation,
  userIdParamValidation,
  updateUserStatusValidation,
  listChildrenValidation,
  childIdParamValidation,
  listPaymentsValidation,
  adminGetPlaydatesValidation,
  adminCancelPlaydateValidation,
  adminGetConnectionsValidation,
  adminDeleteConnectionValidation,
  mongoIdParamValidation,
} from './admin.validation.js';
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

// Parent accounts management
router.get('/users', validate(listUsersValidation), adminController.getUsers);
// Before /users/:id, which would take 'stats' as an ID
router.get('/users/stats', adminController.getUserStats);
router.get('/users/:id', validate(userIdParamValidation), adminController.getUserDetail);
router.patch('/users/:id/status', validate(updateUserStatusValidation), adminController.updateUserStatus);

// Child profiles (read-only)
router.get('/children', validate(listChildrenValidation), adminController.getChildren);
router.get('/children/stats', adminController.getChildStats);
router.get('/children/:id', validate(childIdParamValidation), adminController.getChildDetail);

// Payments history for parent detail drawer
router.get('/payments', validate(listPaymentsValidation), adminController.getPayments);

// Playdates oversight
router.get('/playdates', validate(adminGetPlaydatesValidation), adminController.getPlaydates);
router.get('/playdates/stats', adminController.getPlaydateStats);
router.get('/playdates/:id', validate(mongoIdParamValidation), adminController.getPlaydateDetail);
router.patch('/playdates/:id/cancel', validate(adminCancelPlaydateValidation), adminController.cancelPlaydate);

// Connections oversight
router.get('/connections', validate(adminGetConnectionsValidation), adminController.getConnections);
router.get('/connections/stats', adminController.getConnectionStats);
router.get('/connections/:id', validate(mongoIdParamValidation), adminController.getConnectionDetail);
router.delete('/connections/:id', validate(adminDeleteConnectionValidation), adminController.removeConnection);

export default router;

