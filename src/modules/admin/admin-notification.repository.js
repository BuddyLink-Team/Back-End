import mongoose from 'mongoose';
import AdminNotification from './admin-notification.model.js';
import { ADMIN_NOTIFICATION_CATEGORIES } from './admin.constants.js';

class AdminNotificationRepository {
  /**
   * Create an admin notification
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    return AdminNotification.create(data);
  }

  /**
   * Page of admin notifications with optional filters
   * @param {Object} options
   * @param {string} [options.category]
   * @param {string} [options.severity]
   * @param {boolean} [options.isRead]
   * @param {string|ObjectId} options.adminId
   * @param {number} options.page
   * @param {number} options.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPage({ category, severity, isRead, adminId, page, limit }) {
    const filter = { isActive: { $ne: false }, deletedAt: null };
    if (category) filter.category = category;
    if (severity) filter.severity = severity;

    if (typeof isRead === 'boolean' && adminId) {
      const adminObjId = new mongoose.Types.ObjectId(adminId);
      if (isRead) {
        filter.readBy = adminObjId;
      } else {
        filter.readBy = { $ne: adminObjId };
      }
    }

    const [items, total] = await Promise.all([
      AdminNotification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AdminNotification.countDocuments(filter),
    ]);

    return { items, total };
  }

  /**
   * Whether a notification of a type was created since an instant
   * @param {string} type
   * @param {Date} since
   * @returns {Promise<boolean>}
   */
  async existsOfTypeSince(type, since) {
    return Boolean(await AdminNotification.exists({ type, createdAt: { $gte: since } }));
  }

  /**
   * Change stream of the notifications being created, by any process
   * @returns {import('mongoose').mongo.ChangeStream}
   */
  watchInserts() {
    return AdminNotification.watch([{ $match: { operationType: 'insert' } }]);
  }

  /**
   * Count unread notifications for an admin, overall and by category
   * @param {string|ObjectId} [adminId] - Without it: notifications no admin has read
   * @returns {Promise<{ total: number, byCategory: Record<string, number> }>}
   */
  async countUnread(adminId) {
    const matchFilter = adminId
      ? { isActive: { $ne: false }, deletedAt: null, readBy: { $ne: new mongoose.Types.ObjectId(adminId) } }
      : { isActive: { $ne: false }, deletedAt: null, readBy: { $size: 0 } };
    const rows = await AdminNotification.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);

    const byCategory = Object.fromEntries(
      Object.values(ADMIN_NOTIFICATION_CATEGORIES).map((cat) => [cat, 0])
    );

    let total = 0;
    rows.forEach((row) => {
      if (byCategory[row._id] !== undefined) {
        byCategory[row._id] = row.count;
      }
      total += row.count;
    });

    return { total, byCategory };
  }

  /**
   * Mark a specific notification as read by an admin
   * @param {string|ObjectId} id
   * @param {string|ObjectId} adminId
   * @returns {Promise<Object|null>}
   */
  async markAsRead(id, adminId) {
    return AdminNotification.findByIdAndUpdate(
      id,
      { $addToSet: { readBy: new mongoose.Types.ObjectId(adminId) } },
      { new: true }
    ).lean();
  }

  /**
   * Mark all notifications (or all in a category) as read by an admin
   * @param {string|ObjectId} adminId
   * @param {string} [category]
   * @returns {Promise<{ modifiedCount: number }>}
   */
  async markAllAsRead(adminId, category) {
    const filter = { isActive: { $ne: false }, deletedAt: null };
    if (category) filter.category = category;
    const adminObjId = new mongoose.Types.ObjectId(adminId);
    filter.readBy = { $ne: adminObjId };

    const result = await AdminNotification.updateMany(
      filter,
      { $addToSet: { readBy: adminObjId } }
    );
    return { modifiedCount: result.modifiedCount };
  }
}

export default new AdminNotificationRepository();
