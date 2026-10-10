import notificationRepository from './notification.repository.js';
import { NOTIFICATION_TYPES } from './notification.constants.js';

class NotificationService {
  /**
   * Notify a user that a badge was unlocked
   * @param {string|ObjectId} recipientUserId - users._id
   * @param {{ code: string, title: string, description: string }} badge
   * @returns {Promise<Object>}
   */
  async notifyBadgeUnlocked(recipientUserId, badge) {
    return notificationRepository.create({
      recipientId: recipientUserId,
      type: NOTIFICATION_TYPES.BADGE_UNLOCKED,
      title: 'Bạn vừa mở khóa huy hiệu mới!',
      body: `Huy hiệu "${badge.title}": ${badge.description}`,
      data: { badgeCode: badge.code },
    });
  }
}

export const notificationService = new NotificationService();
export default notificationService;
