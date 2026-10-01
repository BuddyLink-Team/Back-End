import { Router } from 'express';
import playdateController from './playdate.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import {
  getPlaydatesValidation,
  playdateIdParamValidation,
  createPlaydateValidation,
  cancelPlaydateValidation,
} from './playdate.validation.js';

const router = Router();

// Routes require authenticated parent
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT, 'PARENT', 'parent'));

// GET /api/v1/playdates?status=...
router.get('/', validate(getPlaydatesValidation), playdateController.getPlaydates);

// POST /api/v1/playdates
router.post('/', validate(createPlaydateValidation), playdateController.createPlaydate);

// GET /api/v1/playdates/friends (Invitable connected friends)
router.get('/friends', playdateController.getInvitableFriends);

// GET /api/v1/playdates/:id
router.get('/:id', validate(playdateIdParamValidation), playdateController.getPlaydateById);

// PATCH /api/v1/playdates/:id/complete (also support PUT)
router.patch('/:id/complete', validate(playdateIdParamValidation), playdateController.completePlaydate);
router.put('/:id/complete', validate(playdateIdParamValidation), playdateController.completePlaydate);

// PATCH /api/v1/playdates/:id/cancel
router.patch('/:id/cancel', validate(cancelPlaydateValidation), playdateController.cancelPlaydate);

export default router;
