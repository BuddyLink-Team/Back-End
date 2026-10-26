import { Router } from 'express';
import aiAssistantController from './ai-assistant.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { aiMessageLimiter } from '../../middlewares/rate-limit.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import { sessionIdValidation, listSessionsValidation, sendMessageValidation } from './ai-assistant.validation.js';

const router = Router();

// Parents only
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT));

// Chat sessions (newest first)
router.post('/sessions', aiAssistantController.createSession);
router.get('/sessions', validate(listSessionsValidation), aiAssistantController.listSessions);
router.get('/sessions/:id', validate(sessionIdValidation), aiAssistantController.getSession);
router.delete('/sessions/:id', validate(sessionIdValidation), aiAssistantController.deleteSession);

// Send a message (typed, or a tapped choice) and get the AI reply with its cards
router.post('/sessions/:id/messages', aiMessageLimiter, validate(sendMessageValidation), aiAssistantController.sendMessage);

export default router;
