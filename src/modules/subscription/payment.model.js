import mongoose from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_STATUS } from './subscription.constants.js';

const paymentSchema = new mongoose.Schema(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      required: true,
      index: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'VND',
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      default: PAYMENT_METHODS.PAYOS,
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'payments',
  }
);

paymentSchema.index({ parentId: 1, createdAt: -1 });

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

export default Payment;
