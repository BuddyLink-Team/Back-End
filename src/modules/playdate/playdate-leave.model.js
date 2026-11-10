import mongoose from 'mongoose';

/**
 * One family leaving a playdate they had joined. Kept apart from the playdate participants, whose
 * entries are replaced when the family is invited again, so the reliability history is never lost.
 */
const playdateLeaveSchema = new mongoose.Schema(
  {
    playdateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Playdate',
      required: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
    },
    leftAt: {
      type: Date,
      required: true,
    },
    // Start of the playdate when the family left
    scheduledStart: {
      type: Date,
      required: true,
    },
    hoursBeforeStart: {
      type: Number,
      required: true,
    },
    // Left less than LEAVE_RULES.LATE_HOURS before the start (never set when safetyExempt)
    isLate: {
      type: Boolean,
      default: false,
    },
    // The family had blocked the host or another joined family: leaving is a safety choice, never counted
    safetyExempt: {
      type: Boolean,
      default: false,
    },
    reason: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'playdate_leaves',
  }
);

playdateLeaveSchema.index({ parentId: 1, leftAt: -1 });
playdateLeaveSchema.index({ playdateId: 1 });

const PlaydateLeave = mongoose.models.PlaydateLeave || mongoose.model('PlaydateLeave', playdateLeaveSchema);

export default PlaydateLeave;
