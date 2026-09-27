import mongoose from 'mongoose';
import { SUBSCRIPTION_PLAN_CODES, SUBSCRIPTION_STATUS } from './subscription.constants.js';

const subscriptionSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    planCode: {
      type: String,
      enum: Object.values(SUBSCRIPTION_PLAN_CODES),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.ACTIVE,
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null, // null for Free plan
    },
    autoRenew: {
      type: Boolean,
      default: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'subscriptions',
  }
);

subscriptionSchema.index({ parentId: 1, status: 1 });

const Subscription =
  mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);

export default Subscription;
