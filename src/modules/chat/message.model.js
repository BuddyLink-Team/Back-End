import mongoose from 'mongoose';
import { MESSAGE_TYPES } from './chat.constants.js';

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(MESSAGE_TYPES),
      default: MESSAGE_TYPES.TEXT,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    poll: {
      question: { type: String, default: null },
      options: [
        {
          id: { type: String, required: true },
          date: { type: String, default: null },
          time: { type: String, default: null },
          label: { type: String, required: true },
          voterParentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Parent' }],
        },
      ],
      deadline: { type: Date, default: null },
      isClosed: { type: Boolean, default: false },
    },
    readBy: [
      {
        parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true },
        readAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'messages',
  }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

export default Message;
