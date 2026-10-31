import mongoose from 'mongoose';
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  ADMIN_NOTIFICATION_SEVERITY,
  ADMIN_NOTIFICATION_TTL_SECONDS,
} from './admin.constants.js';

const adminNotificationSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: Object.values(ADMIN_NOTIFICATION_CATEGORIES),
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    severity: {
      type: String,
      enum: Object.values(ADMIN_NOTIFICATION_SEVERITY),
      default: ADMIN_NOTIFICATION_SEVERITY.INFO,
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
adminNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: ADMIN_NOTIFICATION_TTL_SECONDS });
adminNotificationSchema.index({ category: 1, createdAt: -1 });
adminNotificationSchema.index({ type: 1, createdAt: -1 });
adminNotificationSchema.index({ readBy: 1 });

const AdminNotification =
  mongoose.models.AdminNotification ||
  mongoose.model('AdminNotification', adminNotificationSchema);

export default AdminNotification;
