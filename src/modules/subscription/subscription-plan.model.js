import mongoose from 'mongoose';
import { SUBSCRIPTION_PLAN_CODES, BILLING_CYCLES } from './subscription.constants.js';

const subscriptionPlanSchema = new mongoose.Schema(
  {
    planCode: {
      type: String,
      enum: Object.values(SUBSCRIPTION_PLAN_CODES),
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: 'VND',
      trim: true,
    },
    durationMonths: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    billingCycle: {
      type: String,
      enum: Object.values(BILLING_CYCLES),
      default: BILLING_CYCLES.NONE,
    },
    features: {
      childProfilesLimit: { type: Number, default: 1 }, // -1 = unlimited
      discoverySwipesLimitPerDay: { type: Number, default: 5 }, // -1 = unlimited
      discoveryViewLimitPerDay: { type: Number, default: 5 },
      connectionRequestsLimitPerMonth: { type: Number, default: 5 },
      playdatesCreatedLimitPerMonth: { type: Number, default: 3 }, // -1 = unlimited
      playdatesLimitPerMonth: { type: Number, default: 3 },
      playdateParticipationLimitPerMonth: { type: Number, default: 3 },
      aiAssistantLimitPerMonth: { type: Number, default: 5 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'subscription_plans',
  }
);

const SubscriptionPlan =
  mongoose.models.SubscriptionPlan ||
  mongoose.model('SubscriptionPlan', subscriptionPlanSchema);

export default SubscriptionPlan;
