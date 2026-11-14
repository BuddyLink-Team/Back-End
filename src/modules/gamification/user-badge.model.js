import mongoose from 'mongoose';

const userBadgeSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    badgeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Badge',
      required: true,
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
userBadgeSchema.index({ parentId: 1, badgeId: 1 }, { unique: true });

const UserBadge = mongoose.models.UserBadge || mongoose.model('UserBadge', userBadgeSchema);

export default UserBadge;
