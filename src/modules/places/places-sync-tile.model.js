import mongoose from 'mongoose';
import { PLACES_SYNC_TILE_STATUS } from './places.constants.js';

/**
 * One cell of the fixed places sync grid (cells aligned on multiples of cellSizeDeg).
 * Records which parts of the map are already in places_cache, so an area is fetched from
 * OpenStreetMap once per PLACES_DEFAULTS.CACHE_TTL_DAYS instead of on every search.
 */
const placesSyncTileSchema = new mongoose.Schema(
  {
    // "<cellSizeDeg>:<row>:<col>", row = floor(lat / size), col = floor(lng / size)
    key: {
      type: String,
      required: true,
      unique: true,
    },
    cellSizeDeg: {
      type: Number,
      required: true,
    },
    // [south, west, north, east]
    bbox: {
      type: [Number],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(PLACES_SYNC_TILE_STATUS),
      required: true,
    },
    placesCount: {
      type: Number,
      default: 0,
    },
    startedAt: Date,
    syncedAt: Date,
    lastError: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'places_sync_tiles',
  }
);

const PlacesSyncTile =
  mongoose.models.PlacesSyncTile || mongoose.model('PlacesSyncTile', placesSyncTileSchema);

export default PlacesSyncTile;
