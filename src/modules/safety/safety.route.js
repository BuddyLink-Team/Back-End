import { Router } from 'express';
import safetyController from './safety.controller.js';
import authenticate from '../../middlewares/auth.middleware.js';
import validate from '../../middlewares/validate.middleware.js';
import { uploadSingleImage } from '../../middlewares/upload.middleware.js';
import {
  blockUserValidation,
  unblockUserValidation,
  createReportValidation,
  getBlockedUsersValidation,
} from './safety.validation.js';

const router = Router();

// Require authentication for all safety endpoints
router.use(authenticate);

router.post('/block', validate(blockUserValidation), safetyController.blockUser);
router.delete('/unblock/:id', validate(unblockUserValidation), safetyController.unblockUser);
router.get('/blocked-users', validate(getBlockedUsersValidation), safetyController.getBlockedUsers);
router.post('/reports/evidence', uploadSingleImage, safetyController.uploadEvidence);
router.post('/reports', validate(createReportValidation), safetyController.createReport);

export default router;
