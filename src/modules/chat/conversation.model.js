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
    // Order-independent direct conversation pair identifier "minId_maxId"
    pairKey: {
      type: String,
      default: null,
      index: true,
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

// Derive pairKey for direct conversations between 2 parents to prevent duplicate creations
conversationSchema.pre('validate', function setPairKey(next) {
  if (this.type === CONVERSATION_TYPES.DIRECT && Array.isArray(this.participants) && this.participants.length === 2) {
    const sortedIds = this.participants.map((id) => id.toString()).sort();
    this.pairKey = sortedIds.join('_');
  }
  next();
});

conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index({ playdateId: 1 });
conversationSchema.index(
  { pairKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: CONVERSATION_TYPES.DIRECT,
      isActive: true,
      pairKey: { $exists: true, $type: 'string' },
    },
  }
);

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);


export default Conversation;
