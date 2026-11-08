import chatService from './chat.service.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';

let isRegistered = false;

/**
 * Chat reactions to other modules' events. Registered once at app startup.
 */
export const registerChatEventListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  // Keep the playdate group chat members = host + accepted participants
  onPlaydateEvent(PLAYDATE_EVENTS.MEMBERS_CHANGED, ({ playdateId }) =>
    chatService.syncPlaydateConversation(playdateId),
  );
};

export default registerChatEventListeners;
