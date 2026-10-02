import mongoose from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_STATUS, SUBSCRIPTION_PLAN_CODES } from './subscription.constants.js';

const paymentSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
      index: true,
    },
    orderCode: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      default: null,
      trim: true,
    },
    fingerprint: {
      type: String,
      default: null,
      trim: true,
    },
    planSnapshot: {
      planCode: {
        type: String,
        enum: Object.values(SUBSCRIPTION_PLAN_CODES),
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      price: {
        type: Number,
        required: true,
      },
      currency: {
        type: String,
        default: 'VND',
      },
      durationMonths: {
        type: Number,
        required: true,
      },
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'VND',
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      default: PAYMENT_METHODS.PAYOS,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.CREATING,
      index: true,
    },
    paymentLinkId: {
      type: String,
      default: null,
      trim: true,
    },
    checkoutUrl: {
      type: String,
      default: null,
      trim: true,
    },
    qrCode: {
      type: String,
      default: null,
      trim: true,
    },
    transactionId: {
      type: String,
      default: null,
      trim: true,
    },
    bankInfo: {
      bin: { type: String, default: null },
      accountNumber: { type: String, default: null },
      accountName: { type: String, default: null },
      description: { type: String, default: null },
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    fulfilledAt: {
      type: Date,
      default: null,
    },
    lastReconciledAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    grantResult: {
      effectiveStartDate: { type: Date, default: null },
      effectiveEndDate: { type: Date, default: null },
      monthsGranted: { type: Number, default: null },
    },
    rawWebhookData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'payments',
  }
);

paymentSchema.index(
  { parentId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
paymentSchema.index({ parentId: 1, createdAt: -1, _id: -1 });
paymentSchema.index(
  { paymentLinkId: 1 },
  { unique: true, partialFilterExpression: { paymentLinkId: { $type: 'string' } } }
);

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

export default Payment;
