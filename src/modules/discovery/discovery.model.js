import mongoose from 'mongoose';

const swipeSchema = new mongoose.Schema(
  {
    swiperParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    targetChildId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Child',
      required: true,
    },
    targetParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
    },
    isLike: {
      type: Boolean,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'swipes',
  }
);

// Prevent duplicate swipes on the same child, index createdAt to enforce daily free quota
swipeSchema.index({ swiperParentId: 1, targetChildId: 1 }, { unique: true });
swipeSchema.index({ swiperParentId: 1, createdAt: 1 });

const Swipe = mongoose.models.Swipe || mongoose.model('Swipe', swipeSchema);

export default Swipe;
