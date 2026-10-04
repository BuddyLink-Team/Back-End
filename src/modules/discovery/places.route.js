import { Router } from 'express';
import placesController from './places.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import { getNearbyPlacesValidation } from './places.validation.js';

const router = Router();

// Require authenticated user with PARENT or ADMIN role
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT, 'PARENT', 'parent', USER_ROLES.ADMIN, 'ADMIN', 'admin'));

// GET /api/v1/places/nearby
router.get('/nearby', validate(getNearbyPlacesValidation), placesController.getNearbyPlaces);

export default router;
