import mongoose from 'mongoose';

export const ADMIN_NOTIFICATION_CATEGORIES = Object.freeze({
  USERS: 'users',
  PAYMENTS: 'payments',
  PLAYDATES: 'playdates',
  CONNECTIONS: 'connections',
  SAFETY: 'safety',
  SYSTEM: 'system',
});

export const ADMIN_NOTIFICATION_SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
});

const adminNotificationSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: Object.values(ADMIN_NOTIFICATION_CATEGORIES),
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: Object.values(ADMIN_NOTIFICATION_SEVERITY),
      default: ADMIN_NOTIFICATION_SEVERITY.INFO,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    entityType: {
      type: String,
      default: null,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'admin_notifications',
  }
);

// 90-day TTL index
adminNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
adminNotificationSchema.index({ category: 1, createdAt: -1 });
adminNotificationSchema.index({ readBy: 1 });

const AdminNotification =
  mongoose.models.AdminNotification ||
  mongoose.model('AdminNotification', adminNotificationSchema);

export default AdminNotification;
