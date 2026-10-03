import { Router } from 'express';
import safetyController from './safety.controller.js';
import authenticate from '../../middlewares/auth.middleware.js';

const router = Router();

// Require authentication for all safety endpoints
router.use(authenticate);

router.post('/block', safetyController.blockUser);
router.delete('/block/:blockedId', safetyController.unblockUser);
router.post('/report', safetyController.createReport);

export default router;
