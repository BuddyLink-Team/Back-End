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
    // Own child the swipe was made for (null on swipes made before child pairing)
    forChildId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Child',
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'swipes',
  }
);

// One swipe per (own child, target child): a parent may like the same child once for each own child.
// Replaces the old { swiperParentId, targetChildId } unique index (dropped by scripts/migrate-bud48-child-pairs.js).
// Index createdAt to enforce daily free quota
swipeSchema.index({ swiperParentId: 1, forChildId: 1, targetChildId: 1 }, { unique: true });
swipeSchema.index({ swiperParentId: 1, createdAt: 1 });

const Swipe = mongoose.models.Swipe || mongoose.model('Swipe', swipeSchema);

export default Swipe;
