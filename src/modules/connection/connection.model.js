import mongoose from 'mongoose';
import { CONNECTION_STATUS, CHILD_PAIR_SOURCES } from './connection.constants.js';

// Two children (one of each parent) matched on this connection
const childPairSchema = new mongoose.Schema(
  {
    // Sorted [minId, maxId]
    childIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Child',
      required: true,
      validate: [(val) => val.length === 2, 'A child pair must contain exactly 2 children'],
    },
    // "minChildId_maxChildId" (buildChildPairKey)
    pairKey: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      enum: Object.values(CHILD_PAIR_SOURCES),
      required: true,
    },
    matchScore: {
      type: Number,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const connectionSchema = new mongoose.Schema(
  {
    parents: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Parent',
      required: true,
      validate: [val => val.length === 2, 'Connection must contain exactly 2 parents'],
    },
    // Order-independent pair identifier "minId_maxId", derived from parents before validation
    pairKey: {
      type: String,
      required: true,
    },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(CONNECTION_STATUS),
      default: CONNECTION_STATUS.PENDING,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
    declinedAt: {
      type: Date,
      default: null,
    },
    removedAt: {
      type: Date,
      default: null,
    },
    removalReason: {
      type: String,
      default: null,
    },
    removedByAdmin: {
      type: Boolean,
      default: false,
    },
    childPairs: {
      type: [childPairSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'connections',
  }
);

// Keep parents sorted [minId, maxId] and derive pairKey so A->B and B->A map to the same pair
connectionSchema.pre('validate', function setPairKey(next) {
  if (Array.isArray(this.parents) && this.parents.length === 2) {
    const sortedIds = this.parents.map((id) => id.toString()).sort();
    this.parents = sortedIds;
    this.pairKey = sortedIds.join('_');
  }
  next();
});

// Prevent duplicate two-way connections when status is pending or accepted.
// Unique must be on pairKey (a scalar): a unique index on the parents array is multikey,
// which would enforce uniqueness per element and limit each parent to one active connection.
connectionSchema.index(
  { pairKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED] },
    },
  }
);
connectionSchema.index({ parents: 1, status: 1 });
connectionSchema.index({ recipientId: 1, status: 1 });
connectionSchema.index({ requesterId: 1, createdAt: 1 });
connectionSchema.index({ 'childPairs.pairKey': 1 });

const Connection = mongoose.models.Connection || mongoose.model('Connection', connectionSchema);

export default Connection;
