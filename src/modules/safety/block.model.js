import mongoose from 'mongoose';

const blockSchema = new mongoose.Schema(
  {
    blockerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    blockedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'blocks',
  }
);

// Ensure unique one-way block per pair
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);

export default Block;
