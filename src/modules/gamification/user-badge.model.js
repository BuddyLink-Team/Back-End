import mongoose from 'mongoose';
import { BADGE_CODES } from './gamification.constants.js';

const userBadgeSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    badgeCode: {
      type: String,
      enum: Object.values(BADGE_CODES),
      required: true,
      ref: 'Badge',
    },
    unlockedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'user_badges',
  }
);

// Ensure each badge is unlocked at most once per parent (permanent)
userBadgeSchema.index({ parentId: 1, badgeCode: 1 }, { unique: true });

const UserBadge = mongoose.models.UserBadge || mongoose.model('UserBadge', userBadgeSchema);

export default UserBadge;
