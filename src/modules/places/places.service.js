import placesRepository from './places.repository.js';
import overpassAdapter from '../../integrations/maps/overpass.adapter.js';
import geocodingAdapter from '../../integrations/maps/geocoding.adapter.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import logger from '../../shared/logger/index.js';
import { wait } from '../../shared/helpers/async.helper.js';
import env from '../../config/env.js';
import { PLACES_DEFAULTS, PLACES_SYNC_DEFAULTS, PLACES_AUTO_SYNC_DEFAULTS } from './places.constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const METERS_PER_DEG_LAT = 111320;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Cells of the fixed sync grid covering a bounding box. Cells are aligned on multiples of the size,
 * so the same part of the map always gets the same key, whoever syncs it (CLI or auto sync).
 * @param {[number, number, number, number]} bbox - [south, west, north, east]
 * @param {number} cellSizeDeg
 * @returns {Array<{ key: string, bbox: number[], cellSizeDeg: number }>}
 */
export const gridCellsOf = ([south, west, north, east], cellSizeDeg) => {
  // The epsilon keeps 16.0 / 0.1 = 160.00000000000003 from adding a sliver row
  const firstRow = Math.floor(south / cellSizeDeg + 1e-9);
  const lastRow = Math.max(firstRow + 1, Math.ceil(north / cellSizeDeg - 1e-9));
  const firstCol = Math.floor(west / cellSizeDeg + 1e-9);
  const lastCol = Math.max(firstCol + 1, Math.ceil(east / cellSizeDeg - 1e-9));
  const cells = [];
  for (let row = firstRow; row < lastRow; row += 1) {
    for (let col = firstCol; col < lastCol; col += 1) {
      cells.push({
        key: `${cellSizeDeg}:${row}:${col}`,
        bbox: [round6(row * cellSizeDeg), round6(col * cellSizeDeg), round6((row + 1) * cellSizeDeg), round6((col + 1) * cellSizeDeg)],
        cellSizeDeg,
      });
    }
  }
  return cells;
};

// Bounding box [south, west, north, east] of a circle around [lng, lat]
const bboxAround = ([lng, lat], radiusMeters) => {
  const dLat = radiusMeters / METERS_PER_DEG_LAT;
  const dLng = radiusMeters / (METERS_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
};

const isStale = (place, now = Date.now()) =>
  !place.lastFetchedAt || now - new Date(place.lastFetchedAt).getTime() > PLACES_DEFAULTS.CACHE_TTL_DAYS * DAY_MS;

const hasValidCoordinates = (coordinates) =>
  Array.isArray(coordinates) &&
  coordinates.length === 2 &&
  coordinates.every((v) => Number.isFinite(v)) &&
  !(coordinates[0] === 0 && coordinates[1] === 0);

// Great-circle distance in meters between two [lng, lat] points
const distanceMeters = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const toPlaceResponse = (place, center) => {
  const coordinates = place.coordinates?.coordinates || null;
  const [osmType, osmNumber] = (place.osmId || '').replace(/^osm-/, '').split('-');
  return {
    id: place._id.toString(),
    placeId: place.osmId,
    name: place.name,
    address: place.address || '',
    placeType: place.placeType,
    coordinates, // [lng, lat]
    distanceMeters: center && coordinates ? distanceMeters(center, coordinates) : null,
    openingHours: place.openingHours || '',
    phone: place.phone || '',
    website: place.website || '',
    osmUrl: osmType && osmNumber ? `https://www.openstreetmap.org/${osmType}/${osmNumber}` : null,
  };
};

class PlacesService {
  constructor() {
    // Background syncs run one after another (see syncAround)
    this._autoSyncQueue = Promise.resolve();
    this._lastAutoSyncAt = 0;
  }

  /**
   * Run once at startup: the cache moved from Google Places (googlePlaceId) to OpenStreetMap (osmId)
   */
  async ensureIndexes() {
    await placesRepository.syncIndexes();
  }

  /**
   * Center of a nearby search: the given lat/lng, otherwise the parent's saved location
   * @returns {Promise<[number, number]|null>} [lng, lat]
   */
  async _resolveCenter(userId, lat, lng) {
    if (lat !== undefined && lng !== undefined) return [parseFloat(lng), parseFloat(lat)];
    const parent = await parentService.getParentByUserId(userId);
    const coordinates = parent?.location?.coordinates?.coordinates;
    return hasValidCoordinates(coordinates) ? coordinates : null;
  }

  /**
   * Nearby Places / Search Places (PROJECT_OVERVIEW 7.2): kid-friendly places around the parent,
   * nearest first, optionally filtered by type and name. Reads the cache only: the public Overpass API
   * is too slow to wait for, the cache is filled by the places sync (scripts/sync-places.js) and in the
   * background around the searching parent (queueSyncAround).
   *
   * @param {string} userId
   * @param {Object} query
   * @param {number|string} [query.lat]
   * @param {number|string} [query.lng]
   * @param {number|string} [query.radius]
   * @param {string} [query.type]
   * @param {string} [query.search] - name / address keyword (alias: keyword)
   * @param {number|string} [query.limit]
   * @returns {Promise<{ places: Array<Object>, areaSyncing: boolean }>}
   */
  async getNearbyPlaces(userId, { lat, lng, radius, type, keyword, search, limit } = {}) {
    const searchTerm = (search || keyword || '').trim();
    const parsedLimit = Math.min(PLACES_DEFAULTS.MAX_LIMIT, Math.max(1, parseInt(limit, 10) || PLACES_DEFAULTS.LIMIT));
    const placeType = type && type !== 'all' ? type : undefined;
    const filterQuery = placesRepository.buildFilterQuery({ type: placeType, searchTerm });

    const center = await this._resolveCenter(userId, lat, lng);
    if (!center) {
      // Without a location only a name search over the cache is possible
      if (!searchTerm) {
        throw new AppError(
          'Set your location in your profile to see nearby places',
          400,
          'PARENT_LOCATION_REQUIRED'
        );
      }
      const places = await placesRepository.findByFilter({ filterQuery, limit: parsedLimit });
      return { places: places.map((p) => toPlaceResponse(p, null)), areaSyncing: false };
    }

    // Fill the cache around this parent in the background when the area was never synced
    let areaSyncing = false;
    try {
      const sync = await this.queueSyncAround(center);
      areaSyncing = sync.areaSyncing;
      sync.done.catch((error) => logger.warn(`[PlacesService] Auto sync failed: ${error.message}`));
    } catch (error) {
      // The search itself must keep working
      logger.warn(`[PlacesService] Auto sync could not start: ${error.message}`);
    }

    const radiusMeters =
      parseInt(radius, 10) || (searchTerm ? PLACES_DEFAULTS.SEARCH_RADIUS_METERS : PLACES_DEFAULTS.RADIUS_METERS);
    const places = await placesRepository.findNearby({
      coordinates: center,
      radiusInMeters: radiusMeters,
      filterQuery,
      limit: parsedLimit,
    });
    return { places: places.map((p) => toPlaceResponse(p, center)), areaSyncing };
  }

  /**
   * Fill the cache with every kid-friendly place of an area from OpenStreetMap.
   * The area is split into cells of the fixed grid (gridCellsOf) queried one after another (public API
   * limits); a failed cell is reported and skipped so the rest still syncs. Re-running refreshes existing
   * places. Each cell is recorded in places_sync_tiles, so the auto sync skips it.
   *
   * @param {[number, number, number, number]} bbox - [south, west, north, east]
   * @param {Object} [options]
   * @param {number} [options.cellSizeDeg]
   * @param {number} [options.delayMs] - pause between cells
   * @param {number} [options.timeoutMs]
   * @param {number} [options.retries]
   * @param {number} [options.retryDelayMs]
   * @param {(progress: Object) => void} [options.onProgress]
   * @returns {Promise<{ cells: number, places: number, failedCells: Array<Object> }>}
   */
  async syncArea(bbox, options = {}) {
    const {
      cellSizeDeg = PLACES_SYNC_DEFAULTS.CELL_SIZE_DEG,
      delayMs = PLACES_SYNC_DEFAULTS.DELAY_BETWEEN_CELLS_MS,
      timeoutMs = PLACES_SYNC_DEFAULTS.TIMEOUT_MS,
      retries = PLACES_SYNC_DEFAULTS.RETRIES,
      retryDelayMs = PLACES_SYNC_DEFAULTS.RETRY_DELAY_MS,
      onProgress,
    } = options;
    const cells = gridCellsOf(bbox, cellSizeDeg);

    let placesCount = 0;
    const failedCells = [];
    for (let i = 0; i < cells.length; i += 1) {
      if (i > 0 && delayMs > 0) await wait(delayMs);
      const result = await this._syncCell(cells[i], { timeoutMs, retries, retryDelayMs });
      if (result.error) {
        failedCells.push({ bbox: cells[i].bbox, error: result.error });
        onProgress?.({ cell: i + 1, cells: cells.length, error: result.error });
      } else {
        placesCount += result.places;
        onProgress?.({ cell: i + 1, cells: cells.length, places: result.places });
      }
    }

    return { cells: cells.length, places: placesCount, failedCells };
  }

  /**
   * Fetch one grid cell from OpenStreetMap into the cache and record the outcome
   * @returns {Promise<{ places?: number, error?: string }>}
   */
  async _syncCell(cell, overpassOptions) {
    try {
      const places = await overpassAdapter.searchArea(cell.bbox, overpassOptions);
      await placesRepository.bulkUpsert(places);
      await placesRepository.saveSyncTileResult(cell, { placesCount: places.length });
      return { places: places.length };
    } catch (error) {
      logger.warn(`[PlacesService] Sync of cell [${cell.bbox.join(', ')}] failed: ${error.message}`);
      await placesRepository.saveSyncTileResult(cell, { error: error.message }).catch(() => {});
      return { error: error.message };
    }
  }

  /**
   * Background fill of the cache around a search center: the grid cells within
   * PLACES_AUTO_SYNC_DEFAULTS.RADIUS_METERS that were never synced (or are older than the cache TTL)
   * are queued and fetched one after another, so the next search there finds places.
   * Only the cell locks are awaited: the public Overpass API is too slow for a request to wait for.
   *
   * @param {[number, number]} center - [lng, lat]
   * @param {Object} [options]
   * @param {number} [options.delayMs] - pause between cells
   * @returns {Promise<{ queued: number, areaSyncing: boolean, done: Promise<void> }>}
   *   areaSyncing: a cell around the center is being synced (by this call or an earlier one)
   */
  async queueSyncAround(center, { delayMs = PLACES_SYNC_DEFAULTS.DELAY_BETWEEN_CELLS_MS } = {}) {
    if (!overpassAdapter.isEnabled || !env.PLACES.AUTO_SYNC) {
      return { queued: 0, areaSyncing: false, done: Promise.resolve() };
    }

    const now = Date.now();
    const limits = {
      now: new Date(now),
      staleBefore: new Date(now - PLACES_DEFAULTS.CACHE_TTL_DAYS * DAY_MS),
      retryFailedBefore: new Date(now - PLACES_AUTO_SYNC_DEFAULTS.RETRY_AFTER_MS),
      lockStaleBefore: new Date(now - PLACES_AUTO_SYNC_DEFAULTS.STALE_LOCK_MS),
    };
    const cells = gridCellsOf(bboxAround(center, PLACES_AUTO_SYNC_DEFAULTS.RADIUS_METERS), PLACES_SYNC_DEFAULTS.CELL_SIZE_DEG);

    const claimed = [];
    for (const cell of cells) {
      if (await placesRepository.claimSyncTile(cell, limits)) claimed.push(cell);
    }
    const areaSyncing =
      claimed.length > 0 ||
      (await placesRepository.countSyncingTiles(cells.map((c) => c.key), limits.lockStaleBefore)) > 0;
    if (claimed.length === 0) return { queued: 0, areaSyncing, done: Promise.resolve() };

    logger.info(`[PlacesService] Auto sync of ${claimed.length} cell(s) around [${center.join(', ')}] queued`);
    // One shared queue: searches from many parents never hit Overpass in parallel
    const done = this._autoSyncQueue.then(async () => {
      for (const cell of claimed) {
        // Keep delayMs between two Overpass calls, also across batches of different searches
        const pause = this._lastAutoSyncAt + delayMs - Date.now();
        if (pause > 0) await wait(pause);
        this._lastAutoSyncAt = Date.now();
        await this._syncCell(cell, { timeoutMs: PLACES_SYNC_DEFAULTS.TIMEOUT_MS });
      }
    });
    this._autoSyncQueue = done.catch(() => {});
    return { queued: claimed.length, areaSyncing, done };
  }

  /**
   * queueSyncAround, resolved once the queued cells are synced
   * @returns {Promise<{ queued: number }>}
   */
  async syncAround(center, options) {
    const { queued, done } = await this.queueSyncAround(center, options);
    await done;
    return { queued };
  }

  /**
   * Place Details (PROJECT_OVERVIEW 7.2). Refreshes stale OSM data and resolves a missing
   * address once with reverse geocoding (saved in the cache).
   *
   * @param {string} userId
   * @param {string} placeId - places_cache _id
   * @returns {Promise<Object>}
   */
  async getPlaceById(userId, placeId) {
    let place = await placesRepository.findById(placeId);
    if (!place) throw new AppError('Place not found', 404, 'PLACE_NOT_FOUND');

    const update = {};
    if (isStale(place)) {
      try {
        const fresh = await overpassAdapter.getByOsmId(place.osmId);
        if (fresh) {
          const { address, ...rest } = fresh;
          Object.assign(update, rest, address ? { address } : {});
        }
      } catch (error) {
        logger.warn(`[PlacesService] OpenStreetMap refresh failed for ${place.osmId}: ${error.message}`);
      }
    }

    if (!place.address && !update.address) {
      const [lng, lat] = place.coordinates.coordinates;
      const resolved = await geocodingAdapter.reverseGeocode(lng, lat);
      if (resolved) update.address = resolved;
    }

    if (Object.keys(update).length > 0) place = await placesRepository.updateById(placeId, update);

    const center = await this._resolveCenter(userId);
    return toPlaceResponse(place, center);
  }
}

export default new PlacesService();
