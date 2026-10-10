import Notification from './notification.model.js';

class NotificationRepository {
  /**
   * Create an in-app notification
   * @param {Object} notificationData
   * @returns {Promise<Object>}
   */
  async create(notificationData) {
    return Notification.create(notificationData);
  }
}

export const notificationRepository = new NotificationRepository();
export default notificationRepository;
