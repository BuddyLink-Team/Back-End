import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import ratingFeedbackController from './rating-feedback.controller.js';
import { createRatingValidation } from './rating-feedback.validation.js';

const router = Router();

router.use(authenticate, authorizeRoles(USER_ROLES.PARENT));

// Supporting read endpoint for automatically opening the rating dialog.
router.get('/ratings/pending', ratingFeedbackController.getPendingRatings);
router.post('/:id/ratings', validate(createRatingValidation), ratingFeedbackController.createRating);

export default router;
