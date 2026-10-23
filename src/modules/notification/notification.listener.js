import logger from '../../shared/logger/index.js';
import notificationService from './notification.service.js';
import { NOTIFICATION_TYPES } from './notification.constants.js';
import parentService from '../parent/parent.service.js';
import playdateService from '../playdate/playdate.service.js';
import { onConnectionEvent, CONNECTION_EVENTS } from '../connection/connection.events.js';
import { onPlaydateEvent, PLAYDATE_EVENTS } from '../playdate/playdate.events.js';

let isRegistered = false;

/**
 * Register cross-module domain event listeners to automatically trigger notifications.
 * Adheres to BACKEND_AI_GUIDE: Services must be called instead of repositories of other modules.
 */
export const registerNotificationListeners = () => {
  if (isRegistered) return;
  isRegistered = true;

  // 1. Connection Request sent -> notify the recipient parent
  onConnectionEvent(CONNECTION_EVENTS.REQUESTED, async ({ requesterParentId, recipientParentId }) => {
    try {
      const [requester, recipient] = await Promise.all([
        parentService.getParentById(requesterParentId),
        parentService.getParentById(recipientParentId),
      ]);

      if (!recipient?.userId) return;

      const requesterName = requester?.fullName || 'Một phụ huynh';
      await notificationService.createNotification({
        recipientId: recipient.userId,
        type: NOTIFICATION_TYPES.CONNECTION_REQUEST,
        title: 'Lời mời kết nối mới',
        body: `${requesterName} đã gửi lời mời kết nối đến bạn.`,
        data: {
          senderId: requesterParentId,
        },
      });
    } catch (err) {
      logger.error(`[NotificationListeners] Connection requested notification failed: ${err.message}`);
    }
  });

  // 2. Connection Request accepted -> notify the requester parent
  onConnectionEvent(CONNECTION_EVENTS.ACCEPTED, async ({ requesterId, recipientId }) => {
    try {
      if (!requesterId || !recipientId) return;

      const [requester, recipient] = await Promise.all([
        parentService.getParentById(requesterId),
        parentService.getParentById(recipientId),
      ]);

      if (!requester?.userId) return;

      const recipientName = recipient?.fullName || 'Một phụ huynh';
      await notificationService.createNotification({
        recipientId: requester.userId,
        type: NOTIFICATION_TYPES.CONNECTION_ACCEPTED,
        title: 'Lời mời kết nối đã được chấp nhận',
        body: `${recipientName} đã đồng ý kết nối với bạn. Giờ hai bạn đã có thể trò chuyện!`,
        data: {
          senderId: recipientId,
        },
      });
    } catch (err) {
      logger.error(`[NotificationListeners] Connection accepted notification failed: ${err.message}`);
    }
  });

  // 3. Playdate Invitation sent -> notify invited participant parents concurrently
  onPlaydateEvent(PLAYDATE_EVENTS.INVITED, async ({ playdateId, hostParentId, participantParentIds = [] }) => {
    try {
      const [host, playdate] = await Promise.all([
        parentService.getParentById(hostParentId),
        playdateService.getPlaydateById(playdateId),
      ]);

      const hostName = host?.fullName || 'Một phụ huynh';
      const activity = playdate?.activity || 'buổi hẹn chơi';

      await Promise.allSettled(
        participantParentIds.map(async (pId) => {
          try {
            const participant = await parentService.getParentById(pId);
            if (!participant?.userId) return;

            await notificationService.createNotification({
              recipientId: participant.userId,
              type: NOTIFICATION_TYPES.PLAYDATE_INVITE,
              title: 'Lời mời tham gia Playdate',
              body: `${hostName} đã mời bạn và bé tham gia "${activity}".`,
              data: {
                senderId: hostParentId,
                playdateId,
              },
            });
          } catch (subErr) {
            logger.error(`[NotificationListeners] Playdate invite notification failed for parent ${pId}: ${subErr.message}`);
          }
        })
      );
    } catch (err) {
      logger.error(`[NotificationListeners] Playdate invited notification handler failed: ${err.message}`);
    }
  });
};

export default registerNotificationListeners;
