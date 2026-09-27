import mongoose from 'mongoose';
import { RESCHEDULE_STATUS, PARTICIPANT_STATUS } from './playdate.constants.js';

const rescheduleResponseSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PARTICIPANT_STATUS),
      default: PARTICIPANT_STATUS.PENDING,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const rescheduleRequestSchema = new mongoose.Schema(
  {
    playdateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Playdate',
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    newDate: {
      type: Date,
      required: true,
    },
    newStartTime: {
      type: String,
      required: true,
    },
    newLocation: {
      name: { type: String },
      address: { type: String },
      placeId: { type: String },
      coordinates: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] },
      },
    },
    reason: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: Object.values(RESCHEDULE_STATUS),
      default: RESCHEDULE_STATUS.PENDING,
      index: true,
    },
    responses: [rescheduleResponseSchema],
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'reschedule_requests',
  }
);

rescheduleRequestSchema.index({ playdateId: 1, status: 1 });
rescheduleRequestSchema.index({ requestedBy: 1 });

const RescheduleRequest =
  mongoose.models.RescheduleRequest || mongoose.model('RescheduleRequest', rescheduleRequestSchema);

export default RescheduleRequest;
