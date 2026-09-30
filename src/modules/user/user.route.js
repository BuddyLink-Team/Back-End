import { Router } from 'express';
import userController from './user.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { uploadAvatar } from '../../middlewares/upload.middleware.js';
import {
  changeUserPasswordValidation,
  updateUserProfileValidation,
} from './user.validation.js';

const router = Router();

// All routes require authenticated user
router.use(authenticate);

// Profile endpoints
router.get('/me', userController.getMe);
router.put('/me', validate(updateUserProfileValidation), userController.updateMe);
router.patch('/me/avatar', uploadAvatar.single('avatar'), userController.updateAvatar);

// Password endpoint
router.put('/me/password', validate(changeUserPasswordValidation), userController.changePassword);

export default router;
