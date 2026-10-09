import mongoose from 'mongoose';
import { CONNECTION_STATUS } from './connection.constants.js';

const connectionSchema = new mongoose.Schema(
  {
    parents: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Parent',
      required: true,
      validate: [val => val.length === 2, 'Connection must contain exactly 2 parents'],
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
  },
  {
    timestamps: true,
    collection: 'connections',
  }
);

// Prevent duplicate two-way connections manually in service instead of using array unique index
// connectionSchema.index(
//   { parents: 1 },
//   {
//     unique: true,
//     partialFilterExpression: {
//       status: { $in: [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED] },
//     },
//   }
// );
connectionSchema.index({ parents: 1 });
connectionSchema.index({ recipientId: 1, status: 1 });
connectionSchema.index({ requesterId: 1, createdAt: 1 });

const Connection = mongoose.models.Connection || mongoose.model('Connection', connectionSchema);

export default Connection;
