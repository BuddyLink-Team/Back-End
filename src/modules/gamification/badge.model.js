import mongoose from 'mongoose';
import { BADGE_CODES } from './gamification.constants.js';

const badgeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: Object.values(BADGE_CODES),
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    iconUrl: {
      type: String,
      default: '',
    },
    requirementCount: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    collection: 'badges',
  }
);

const Badge = mongoose.models.Badge || mongoose.model('Badge', badgeSchema);

export default Badge;
