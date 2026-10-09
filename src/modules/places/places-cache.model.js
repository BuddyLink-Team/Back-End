import mongoose from 'mongoose';
import { PLACE_TYPES } from './places.constants.js';

const placesCacheSchema = new mongoose.Schema(
  {
    // OpenStreetMap element id: "osm-node-123" | "osm-way-456" | "osm-relation-789"
    osmId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // OSM often has no addr:* tags: filled by reverse geocoding when the place details are opened
    address: {
      type: String,
      default: '',
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
    openingHours: { type: String, default: '' },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    // Refreshed from OpenStreetMap when older than PLACES_CACHE_TTL_DAYS
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
