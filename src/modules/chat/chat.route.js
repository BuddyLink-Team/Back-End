import { Router } from 'express';
import chatController from './chat.controller.js';
import authenticate from '../../middlewares/auth.middleware.js';
import validate from '../../middlewares/validate.middleware.js';
import { uploadSingleImage } from '../../middlewares/upload.middleware.js';
import {
  createDirectConversationValidation,
  conversationIdParamValidation,
  playdateIdParamValidation,
  sendMessageValidation,
  getMessagesValidation,
  getConversationsValidation,
} from './chat.validation.js';

const router = Router();

// Protect all chat endpoints with JWT authentication
router.use(authenticate);

// Conversations
router.get(
  '/conversations',
  validate(getConversationsValidation),
  chatController.getConversations
);

router.post(
  '/conversations',
  validate(createDirectConversationValidation),
  chatController.getOrCreateDirectConversation
);

// Playdate group conversation
router.get(
  '/playdate/:playdateId',
  validate(playdateIdParamValidation),
  chatController.getOrCreatePlaydateConversation
);

router.get(
  '/conversations/:conversationId',
  validate(conversationIdParamValidation),
  chatController.getConversation
);

// Messages
router.get(
  '/conversations/:conversationId/messages',
  validate(getMessagesValidation),
  chatController.getMessages
);

router.post(
  '/conversations/:conversationId/messages',
  validate(sendMessageValidation),
  chatController.sendMessage
);

// Mark conversation as read
router.post(
  '/conversations/:conversationId/read',
  validate(conversationIdParamValidation),
  chatController.markAsRead
);

// Upload attachment
router.post(
  '/upload',
  uploadSingleImage,
  chatController.uploadAttachment
);

export default router;
