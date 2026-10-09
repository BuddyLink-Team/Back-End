import { Router } from 'express';
import placesController from './places.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import { getNearbyPlacesValidation, getPlaceByIdValidation } from './places.validation.js';

const router = Router();

// Require authenticated user with PARENT or ADMIN role
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT, USER_ROLES.ADMIN));

// GET /api/v1/places/nearby (Nearby + Search: ?type=&search=)
router.get('/nearby', validate(getNearbyPlacesValidation), placesController.getNearbyPlaces);

// GET /api/v1/places/:id (Place Details)
router.get('/:id', validate(getPlaceByIdValidation), placesController.getPlaceById);

export default router;
