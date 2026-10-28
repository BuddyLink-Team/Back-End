import mongoose from 'mongoose';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS, PLAYDATE_RULES } from './playdate.constants.js';

const playdateParticipantSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
    },
    childId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Child',
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PARTICIPANT_STATUS),
      default: PARTICIPANT_STATUS.PENDING,
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    // When this family's participation quota was used for the playdate: set on the first accept,
    // kept when they leave and are invited again, so the same playdate is never counted twice
    quotaConsumedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const playdateSchema = new mongoose.Schema(
  {
    hostParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    hostChildId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Child',
      required: true,
    },
    participants: [playdateParticipantSchema],
    scheduledDate: {
      type: Date,
      required: true,
      index: true,
    },
    time: {
      type: String,
      required: true, // "09:00", "15:30"
    },
    // Old playdates have none: read with `?? PLAYDATE_RULES.DEFAULT_DURATION_MINUTES`
    durationMinutes: {
      type: Number,
      default: PLAYDATE_RULES.DEFAULT_DURATION_MINUTES,
      min: PLAYDATE_RULES.MIN_DURATION_MINUTES,
      max: PLAYDATE_RULES.MAX_DURATION_MINUTES,
    },
    activity: {
      type: String,
      required: true,
    },
    location: {
      name: { type: String, required: true },
      address: { type: String, required: true },
      placeId: { type: String, default: null },
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
        },
        coordinates: {
          type: [Number], // [lng, lat]
        },
      },
    },
    note: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: Object.values(PLAYDATE_STATUS),
      default: PLAYDATE_STATUS.UPCOMING,
      index: true,
    },
    cancellation: {
      cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', default: null },
      reason: { type: String, default: '' },
      cancelledAt: { type: Date, default: null },
    },
    completedAt: {
      type: Date,
      default: null,
    },
    chatConversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    // When each reminder was sent (claimed atomically by the reminder job); reset on reschedule
    reminders: {
      h24SentAt: { type: Date, default: null },
      h1SentAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    collection: 'playdates',
  }
);

playdateSchema.index({ hostParentId: 1, status: 1 });
playdateSchema.index({ 'participants.parentId': 1, status: 1 });
playdateSchema.index({ scheduledDate: 1, status: 1 });
playdateSchema.index({ 'location.coordinates': '2dsphere' }, { sparse: true });

const Playdate = mongoose.models.Playdate || mongoose.model('Playdate', playdateSchema);

export default Playdate;
