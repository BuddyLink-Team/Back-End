import mongoose from 'mongoose';
import { QUOTA_PERIOD_TYPES } from './subscription.constants.js';

const usageQuotaSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    periodType: {
      type: String,
      enum: Object.values(QUOTA_PERIOD_TYPES),
      required: true,
    },
    periodValue: {
      type: String,
      required: true, // 'YYYY-MM-DD' (daily) or 'YYYY-MM' (monthly)
    },
    counters: {
      // Used when periodType === 'daily':
      discoverySwipes: { type: Number, default: 0, min: 0 },

      // Used when periodType === 'monthly':
      playdatesCreated: { type: Number, default: 0, min: 0 },
    },
  },
  {
    timestamps: true,
    collection: 'usage_quotas',
  }
);

// Prevent duplicate quota records for a parent in the same period
usageQuotaSchema.index({ parentId: 1, periodType: 1, periodValue: 1 }, { unique: true });

const UsageQuota =
  mongoose.models.UsageQuota || mongoose.model('UsageQuota', usageQuotaSchema);

export default UsageQuota;
