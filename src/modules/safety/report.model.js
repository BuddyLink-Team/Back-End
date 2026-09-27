import mongoose from 'mongoose';
import { REPORT_TARGET_TYPES, REPORT_STATUS } from './safety.constants.js';

const reportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: Object.values(REPORT_TARGET_TYPES),
      required: true,
    },
    targetMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    targetPlaydateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Playdate',
      default: null,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    evidenceUrls: [{ type: String }],
    status: {
      type: String,
      enum: Object.values(REPORT_STATUS),
      default: REPORT_STATUS.PENDING,
      index: true,
    },
    adminNotes: {
      type: String,
      default: '',
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'reports',
  }
);

reportSchema.index({ status: 1, createdAt: -1 });

const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);

export default Report;
