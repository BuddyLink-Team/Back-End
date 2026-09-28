import mongoose from 'mongoose';
import { NOTIFICATION_TYPES } from './notification.constants.js';

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', default: null },
      playdateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Playdate', default: null },
      conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
      badgeCode: { type: String, default: null },
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notifications',
  }
);

notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

export default Notification;
