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

  /**
   * Find notification by ID
   * @param {string|ObjectId} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    return Notification.findById(id)
      .populate('data.senderId', 'fullName avatarUrl')
      .populate('data.playdateId', 'activity scheduledDate time location');
  }

  /**
   * Find paginated notifications for a recipient
   * @param {string|ObjectId} recipientId
   * @param {Object} options
   * @param {number} [options.page=1]
   * @param {number} [options.limit=10]
   * @param {string} [options.type]
   * @param {boolean} [options.isRead]
   * @returns {Promise<{ items: Array<Object>, total: number, page: number, limit: number, totalPages: number }>}
   */
  async findUserNotifications(recipientId, { page = 1, limit = 10, type, isRead } = {}) {
    const filter = { recipientId };

    if (type) {
      const types = Array.isArray(type)
        ? type
        : String(type).split(',').map((t) => t.trim()).filter(Boolean);
      if (types.length === 1) {
        filter.type = types[0];
      } else if (types.length > 1) {
        filter.type = { $in: types };
      }
    }
    if (typeof isRead === 'boolean') {
      filter.isRead = isRead;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('data.senderId', 'fullName avatarUrl')
        .populate('data.playdateId', 'activity scheduledDate time location'),
      Notification.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  }

  /**
   * Count unread notifications for a user
   * @param {string|ObjectId} recipientId
   * @returns {Promise<number>}
   */
  async countUnread(recipientId) {
    return Notification.countDocuments({ recipientId, isRead: false });
  }

  /**
   * Mark a single notification as read
   * @param {string|ObjectId} id
   * @param {string|ObjectId} recipientId
   * @returns {Promise<Object|null>}
   */
  async markAsRead(id, recipientId) {
    return Notification.findOneAndUpdate(
      { _id: id, recipientId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    )
      .populate('data.senderId', 'fullName avatarUrl')
      .populate('data.playdateId', 'activity scheduledDate time location');
  }

  /**
   * Mark all unread notifications of a user as read
   * @param {string|ObjectId} recipientId
   * @returns {Promise<{ modifiedCount: number }>}
   */
  async markAllAsRead(recipientId) {
    const result = await Notification.updateMany(
      { recipientId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return { modifiedCount: result.modifiedCount || 0 };
  }
}

export const notificationRepository = new NotificationRepository();
export default notificationRepository;

