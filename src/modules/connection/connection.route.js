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

// All connection routes require an authenticated parent
router.use(authenticate);
router.use(authorizeRoles(USER_ROLES.PARENT));

// Connections / requests of the current parent (?status=pending|accepted&direction=incoming|outgoing)
router.get('/', validate(getConnectionsValidation), connectionController.getConnections);

// Send a connection request
router.post('/', validate(requestConnectionValidation), connectionController.createConnectionRequest);

// Accept / decline an incoming request
router.patch('/:id/accept', validate(connectionIdParamValidation), connectionController.acceptConnectionRequest);
router.patch('/:id/decline', validate(connectionIdParamValidation), connectionController.declineConnectionRequest);

// Remove a connection, or cancel a sent request
router.delete('/:id', validate(connectionIdParamValidation), connectionController.removeConnection);

export default router;
