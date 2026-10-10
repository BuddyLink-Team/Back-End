import { Router } from 'express';
import safetyController from './safety.controller.js';
import authenticate from '../../middlewares/auth.middleware.js';
import validate from '../../middlewares/validate.middleware.js';
import { blockUserValidation, createReportValidation } from './safety.validation.js';

const router = Router();

// Require authentication for all safety endpoints
router.use(authenticate);

router.post('/block', validate(blockUserValidation), safetyController.blockUser);
router.delete('/block/:blockedId', safetyController.unblockUser);
router.post('/report', validate(createReportValidation), safetyController.createReport);

export default router;
