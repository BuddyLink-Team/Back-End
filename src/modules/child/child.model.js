import mongoose from 'mongoose';
import { CHILD_GENDERS } from './child.constants.js';

const childSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Parent',
      required: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
    gender: {
      type: String,
      enum: Object.values(CHILD_GENDERS),
      required: true,
    },
    interests: [{ type: String, trim: true }],
    favoriteActivities: [{ type: String, trim: true }],
    personality: [{ type: String, trim: true }],
    avatarUrl: {
      type: String,
      trim: true,
      default: null,
    },
    schoolLevel: {
      type: String,
      trim: true,
      default: null,
    },
    privacySettings: {
      showRealPhoto:   { type: Boolean, default: false },
      showFullName:    { type: Boolean, default: true  },
      showAge:         { type: Boolean, default: true  },
      showGender:      { type: Boolean, default: true  },
      showInterests:   { type: Boolean, default: true  },
      showPersonality: { type: Boolean, default: true  },
      showSchool:      { type: Boolean, default: false },
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'children',
  }
);

childSchema.index({ parentId: 1, isArchived: 1 });
childSchema.index({ dateOfBirth: 1, gender: 1 });
childSchema.index({ interests: 1 });
childSchema.index({ favoriteActivities: 1 });

const Child = mongoose.models.Child || mongoose.model('Child', childSchema);

export default Child;
