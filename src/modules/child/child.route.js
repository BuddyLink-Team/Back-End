import { Router } from 'express';
import childController from './child.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import {
  createChildValidation,
  updateChildValidation,
  childIdParamValidation,
} from './child.validation.js';
import { USER_ROLES } from '../../shared/constants/index.js';

const router = Router();

// Routes require authenticated parent
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT, 'PARENT', 'parent'));

router.get('/', childController.getMyChildren);
router.post('/', validate(createChildValidation), childController.createChild);
router.get('/:id/public-profile', validate(childIdParamValidation), childController.getPublicProfile);
router.get('/:id', validate(childIdParamValidation), childController.getChildById);
router.put('/:id', validate(updateChildValidation), childController.updateChild);
router.delete('/:id', validate(childIdParamValidation), childController.deleteChild);

export default router;
