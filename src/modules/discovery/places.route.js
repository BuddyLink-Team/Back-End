import { Router } from 'express';
import placesController from './places.controller.js';
import { authenticate } from '../../middlewares/auth.middleware.js';

const router = Router();

// Allow authenticated users to search nearby places
router.use(authenticate);

// GET /api/v1/places/nearby
router.get('/nearby', placesController.getNearbyPlaces);

export default router;
