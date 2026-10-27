/**
 * Place types supported for nearby recommendations and playdate place suggestions
 */
export const PLACE_TYPES = Object.freeze({
  PARK: 'park',
  KIDS_CAFE: 'kids_cafe',
  PLAYGROUND: 'playground',
  LIBRARY: 'library',
  SPORTS_CENTER: 'sports_center',
  WORKSHOP: 'workshop',
});

export const PLACES_DEFAULTS = Object.freeze({
  RADIUS_METERS: 5000,
  // Name search looks further than the nearby list
  SEARCH_RADIUS_METERS: 20000,
  LIMIT: 20,
  MAX_LIMIT: 50,
  // A cached place is refreshed from OpenStreetMap after this many days (DATABASE_SCHEMA places_cache)
  CACHE_TTL_DAYS: 30,
});

// Places sync (scripts/sync-places.js): an area is split into cells queried one after another
export const PLACES_SYNC_DEFAULTS = Object.freeze({
  CELL_SIZE_DEG: 0.1, // ~11 km
  DELAY_BETWEEN_CELLS_MS: 3000, // public instances allow ~2 queries at a time
  TIMEOUT_MS: 180000, // a busy public instance can take minutes
  RETRIES: 2,
  RETRY_DELAY_MS: 15000,
  // --city / --bbox refuse larger areas without --force (100 cells of 0.1° ≈ 110 x 110 km)
  MAX_CELLS: 100,
});

// Background sync around a parent who searches places (places.service.js syncAround)
export const PLACES_AUTO_SYNC_DEFAULTS = Object.freeze({
  // Grid cells within this distance of the search center are synced
  RADIUS_METERS: 5000,
  // A failed cell is tried again after this delay
  RETRY_AFTER_MS: 60 * 60 * 1000,
  // A cell still "syncing" after this delay is considered abandoned (server restarted mid-sync)
  STALE_LOCK_MS: 15 * 60 * 1000,
});

// Cache id of an OpenStreetMap element; other ids ("seed-…") are places added by hand, with no OSM page
export const OSM_ID_REGEX = /^osm-(node|way|relation)-(\d+)$/;

// Where a cached place comes from (places_cache.source)
export const PLACE_SOURCES = Object.freeze({
  OSM: 'osm', // places sync: removed from the cache once OpenStreetMap no longer returns it
  MANUAL: 'manual', // added by hand (seed): never removed by a sync
});

// Missing addresses resolved in the background with Nominatim reverse geocoding (1 request per second)
export const PLACES_ADDRESS_LOOKUP_DEFAULTS = Object.freeze({
  INTERVAL_MS: 1100,
  // Places waiting at most: a big sync never floods Nominatim
  MAX_QUEUED: 300,
});

export const PLACES_SYNC_TILE_STATUS = Object.freeze({
  SYNCING: 'syncing',
  DONE: 'done',
  FAILED: 'failed',
});

// Areas that can be synced by name: [south, west, north, east]
export const PLACES_SYNC_AREAS = Object.freeze({
  'da-nang': { label: 'Đà Nẵng (gồm Hội An)', bbox: [15.85, 108.05, 16.2, 108.36] },
  'ho-chi-minh': { label: 'TP. Hồ Chí Minh (nội thành)', bbox: [10.7, 106.6, 10.88, 106.8] },
  'ha-noi': { label: 'Hà Nội (nội thành)', bbox: [20.95, 105.75, 21.1, 105.9] },
});
