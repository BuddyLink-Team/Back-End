import mongoose from 'mongoose';

const ratingFeedbackSchema = new mongoose.Schema(
  {
    playdateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Playdate',
      required: true,
      index: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    feedback: {
      type: String,
      default: '',
      trim: true,
    },
    tags: [{ type: String, trim: true }],
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'ratings_feedbacks',
  }
);

// Each parent can review each playdate at most once
ratingFeedbackSchema.index({ playdateId: 1, parentId: 1 }, { unique: true });

const RatingFeedback =
  mongoose.models.RatingFeedback || mongoose.model('RatingFeedback', ratingFeedbackSchema);

export default RatingFeedback;
