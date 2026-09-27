import mongoose from 'mongoose';
import {
  PREFERRED_DAYS,
  TIME_SLOTS,
  PREFERRED_LOCATIONS,
  CONNECTION_PRIVACY,
  MESSAGE_PRIVACY,
} from './parent.constants.js';

const parentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: '',
    },
    location: {
      address: { type: String, default: '' },
      area: { type: String, default: '' },
      city: { type: String, default: '' },
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number], // [lng, lat]
          default: [0, 0],
        },
      },
    },
    preferences: {
      preferredPlaydateDays: [{ type: String, enum: PREFERRED_DAYS }],
      preferredTimeSlots: [{ type: String, enum: TIME_SLOTS }],
      preferredLocations: [{ type: String, enum: PREFERRED_LOCATIONS }],
      maxDistanceKm: { type: Number, default: 15 },
      preferredAgeRange: {
        min: { type: Number, default: 1 },
        max: { type: Number, default: 12 },
      },
      languages: [{ type: String, default: 'Vietnamese' }],
      additionalNotes: { type: String, default: '' },
    },
    privacySettings: {
      isProfileHidden: { type: Boolean, default: false },
      connectionPrivacy: {
        type: String,
        enum: Object.values(CONNECTION_PRIVACY),
        default: CONNECTION_PRIVACY.EVERYONE,
      },
      messagePrivacy: {
        type: String,
        enum: Object.values(MESSAGE_PRIVACY),
        default: MESSAGE_PRIVACY.CONNECTED_ONLY,
      },
    },
    verification: {
      isEmailVerified: { type: Boolean, default: false },
      isPhoneVerified: { type: Boolean, default: false },
      isVerifiedParent: { type: Boolean, default: false },
    },
    streak: {
      currentWeeklyStreak: { type: Number, default: 0 },
      longestStreak: { type: Number, default: 0 },
      lastCompletedPlaydateWeek: { type: String, default: null },
      streakUpdatedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    collection: 'parents',
  }
);

parentSchema.index({ 'location.coordinates': '2dsphere' });
parentSchema.index({ 'privacySettings.isProfileHidden': 1 });

const Parent = mongoose.models.Parent || mongoose.model('Parent', parentSchema);

export default Parent;
