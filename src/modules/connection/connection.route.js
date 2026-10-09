import { Router } from 'express';
import connectionController from './connection.controller.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { authorizeRoles } from '../../middlewares/role.middleware.js';
import { USER_ROLES } from '../../shared/constants/index.js';
import {
  requestConnectionValidation,
  connectionIdParamValidation,
  getConnectionsValidation,
} from './connection.validation.js';

const router = Router();

// All connection routes require authenticated parent
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT, 'PARENT', 'parent'));

// Get list of connections/requests
router.get('/', validate(getConnectionsValidation), connectionController.getConnections);

// Send connection request
router.post('/request', validate(requestConnectionValidation), connectionController.createConnectionRequest);

// Accept connection request
router.put('/accept/:id', validate(connectionIdParamValidation), connectionController.acceptConnectionRequest);

// Decline connection request
router.put('/decline/:id', validate(connectionIdParamValidation), connectionController.declineConnectionRequest);

// Remove connection
router.delete('/remove/:id', validate(connectionIdParamValidation), connectionController.removeConnection);

export default router;
