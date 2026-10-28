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
    // updatedAt changes when the parent blocks again with another reason
    timestamps: true,
    collection: 'blocks',
  }
);

// Ensure unique one-way block per pair
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);

export default Block;
