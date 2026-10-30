import mongoose from 'mongoose';
import { USER_ROLES } from '../../shared/constants/index.js';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      default: null,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      lowercase: true,
      default: USER_ROLES.PARENT,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    strikeCount: {
      type: Number,
      default: 0,
    },
    suspensionUntil: {
      type: Date,
      default: null,
    },
    banReason: {
      type: String,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Indexes
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ deletedAt: 1 });
userSchema.index({ suspensionUntil: 1 });

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
