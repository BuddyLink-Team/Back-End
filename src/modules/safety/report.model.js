import mongoose from 'mongoose';
import {
  REPORT_TARGET_TYPES,
  REPORT_STATUS,
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  REPORT_ACTION_TYPES,
  REPORT_RESOLUTION_TYPES,
  REPORT_HISTORY_EVENT_TYPES,
} from './safety.constants.js';

const reportActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(REPORT_ACTION_TYPES),
      required: true,
    },
    params: {
      durationDays: { type: Number, default: null },
      reason: { type: String, default: '' },
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    performedAt: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      default: '',
    },
    isPolicyOverride: {
      type: Boolean,
      default: false,
    },
    overrideReason: {
      type: String,
      default: '',
    },
    policyClause: {
      type: String,
      default: '',
    },
  },
  { _id: true }
);

const sentinelAssessmentSchema = new mongoose.Schema(
  {
    summary: { type: String, default: '' },
    violationType: { type: String, default: '' },
    severityRecommendation: {
      type: String,
      enum: Object.values(REPORT_SEVERITY),
      default: null,
    },
    confidenceScore: { type: Number, min: 0, max: 100, default: null },
    strikeCount: { type: Number, default: 1 },
    policyClause: { type: String, default: '' },
    evidenceAnalysis: {
      isValid: { type: Boolean, default: null },
      notes: { type: String, default: '' },
    },
    recommendedSanctions: [
      {
        type: { type: String, enum: Object.values(REPORT_ACTION_TYPES) },
        durationDays: { type: Number, default: null },
        reason: { type: String, default: '' },
      },
    ],
    draftNotes: {
      adminNote: { type: String, default: '' },
      reportedUserNotice: { type: String, default: '' },
      reporterFeedback: { type: String, default: '' },
    },
    assessedAt: { type: Date, default: null },
    assessedByModel: { type: String, default: null },
    autoShieldApplied: { type: Boolean, default: false },
    autoResolved: { type: Boolean, default: false },
    monitoring: {
      reportsReceived: { type: Number, default: 1 },
      timeWindow: { type: String, default: '30 min' },
      totalOpenAgainstUser: { type: Number, default: 1 },
      uniqueReportersCount: { type: Number, default: 1 },
      riskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
      reporterCredibility: {
        level: { type: String, enum: ['high', 'normal', 'low'], default: 'high' },
        label: { type: String, default: '' },
        totalSubmitted: { type: Number, default: 1 },
        confirmedCount: { type: Number, default: 0 },
        dismissedCount: { type: Number, default: 0 },
        coordinatedSuspected: { type: Boolean, default: false },
        isIndependentIncidents: { type: Boolean, default: true },
        incidentPattern: { type: String, default: '' },
      },
      investigationSteps: [{ type: String }],
      temporaryRestriction: {
        applied: { type: Boolean, default: false },
        badgeLabel: { type: String, default: 'Temporary restriction' },
        steps: [{ type: String }],
      },
    },
  },
  { _id: false }
);

const reportHistorySchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: Object.values(REPORT_HISTORY_EVENT_TYPES),
      required: true,
    },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    at: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: true }
);

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
    category: {
      type: String,
      enum: Object.values(REPORT_CATEGORIES),
      required: true,
      // Reports created before categories existed are read (and saved again) as "other"
      default: REPORT_CATEGORIES.OTHER,
      index: true,
    },
    severity: {
      type: String,
      enum: Object.values(REPORT_SEVERITY),
      default: REPORT_SEVERITY.MEDIUM,
      index: true,
    },
    reason: {
      type: String,
      default: '',
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
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    resolution: {
      type: String,
      enum: Object.values(REPORT_RESOLUTION_TYPES),
      default: null,
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
    actions: {
      type: [reportActionSchema],
      default: [],
    },
    sentinelAssessment: {
      type: sentinelAssessmentSchema,
      default: null,
    },
    history: {
      type: [reportHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'reports',
  }
);

// Indexes
reportSchema.index({ reportedUserId: 1, status: 1 });
reportSchema.index({ assignedTo: 1, status: 1 });
reportSchema.index({ status: 1, createdAt: -1 });

const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);

export default Report;
