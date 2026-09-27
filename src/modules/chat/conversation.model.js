import mongoose from 'mongoose';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from './chat.constants.js';

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(CONVERSATION_TYPES),
      required: true,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Parent',
        required: true,
      },
    ],
    playdateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Playdate',
      default: null,
    },
    lastMessage: {
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
      senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent' },
      content: { type: String, default: '' },
      type: { type: String, enum: Object.values(MESSAGE_TYPES), default: MESSAGE_TYPES.TEXT },
      sentAt: { type: Date, default: Date.now },
    },
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'conversations',
  }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index({ playdateId: 1 });

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

export default Conversation;
