import mongoose from 'mongoose';
import { PLACE_TYPES } from './discovery.constants.js';

const placesCacheSchema = new mongoose.Schema(
  {
    googlePlaceId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },
    placeType: {
      type: String,
      enum: Object.values(PLACE_TYPES),
      required: true,
    },
    rating: {
      type: Number,
      default: 0,
    },
    userRatingsTotal: {
      type: Number,
      default: 0,
    },
    lastFetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'places_cache',
  }
);

placesCacheSchema.index({ coordinates: '2dsphere' });

const PlacesCache =
  mongoose.models.PlacesCache || mongoose.model('PlacesCache', placesCacheSchema);

export default PlacesCache;
