import PlacesCache from './places-cache.model.js';
import PlacesSyncTile from './places-sync-tile.model.js';
import { PLACES_SYNC_TILE_STATUS } from './places.constants.js';
import { escapeRegExp } from '../../shared/helpers/regex.helper.js';

/**
 * Escapes special regex characters to prevent ReDoS and regex injection attacks
 * @param {string} str
 * @returns {string}
 */

class PlacesRepository {
  /**
   * Align indexes with the schema (drops legacy ones such as the old googlePlaceId unique index)
   * @returns {Promise<void>}
   */
  async syncIndexes() {
    // Legacy Google Places entries have no osmId: they would collide as null on the unique osmId index
    await PlacesCache.collection.deleteMany({ $or: [{ osmId: { $exists: false } }, { osmId: null }] });
    await PlacesCache.syncIndexes();
    await PlacesSyncTile.syncIndexes();
  }

  /**
   * Insert or refresh places by their OpenStreetMap id.
   * An address already resolved (reverse geocoding) is kept when OSM has none.
   * @param {Array<Object>} places
   * @returns {Promise<void>}
   */
  async bulkUpsert(places) {
    if (!places || places.length === 0) return;
    const bulkOps = places.map(({ address, ...place }) => ({
      updateOne: {
        filter: { osmId: place.osmId },
        update: address ? { $set: { ...place, address } } : { $set: place, $setOnInsert: { address: '' } },
        upsert: true,
      },
    }));
    await PlacesCache.bulkWrite(bulkOps);
  }

  /**
   * Build MongoDB filter criteria with escaped search terms and place type
   * @param {Object} options
   * @param {string} [options.type]
   * @param {string} [options.searchTerm]
   * @returns {Object}
   */
  buildFilterQuery({ type, searchTerm } = {}) {
    const query = {};

    if (type && type !== 'all') {
      query.placeType = type.toLowerCase();
    }

    if (searchTerm && searchTerm.trim()) {
      const escaped = escapeRegExp(searchTerm.trim());
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { address: { $regex: escaped, $options: 'i' } },
      ];
    }

    return query;
  }

  /**
   * Places around a point, nearest first (2dsphere index)
   * @param {Object} options
   * @param {[number, number]} options.coordinates - [lng, lat]
   * @param {number} options.radiusInMeters
   * @param {Object} [options.filterQuery]
   * @param {number} [options.limit]
   * @returns {Promise<Array<Object>>}
   */
  async findNearby({ coordinates, radiusInMeters, filterQuery = {}, limit = 20 }) {
    return PlacesCache.find({
      ...filterQuery,
      coordinates: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates },
          $maxDistance: radiusInMeters,
        },
      },
    })
      .limit(limit)
      .lean();
  }

  /**
   * Places matching a filter without a location, by name
   * @param {Object} options
   * @param {Object} options.filterQuery
   * @param {number} options.limit
   * @returns {Promise<Array<Object>>}
   */
  async findByFilter({ filterQuery = {}, limit = 20 }) {
    return PlacesCache.find(filterQuery).sort({ name: 1 }).limit(limit).lean();
  }

  /**
   * Take the sync lock of a grid cell when it was never synced, is older than staleBefore,
   * failed before retryFailedBefore or was abandoned while syncing before lockStaleBefore.
   * Atomic: when two searches race for the same cell only one gets it.
   * @param {Object} tile - { key, bbox, cellSizeDeg }
   * @param {Object} limits - { now, staleBefore, retryFailedBefore, lockStaleBefore } (Dates)
   * @returns {Promise<boolean>} true when this caller must sync the cell
   */
  async claimSyncTile({ key, bbox, cellSizeDeg }, { now, staleBefore, retryFailedBefore, lockStaleBefore }) {
    try {
      const claimed = await PlacesSyncTile.findOneAndUpdate(
        {
          key,
          $or: [
            { status: PLACES_SYNC_TILE_STATUS.DONE, syncedAt: { $lt: staleBefore } },
            { status: PLACES_SYNC_TILE_STATUS.FAILED, updatedAt: { $lt: retryFailedBefore } },
            { status: PLACES_SYNC_TILE_STATUS.SYNCING, startedAt: { $lt: lockStaleBefore } },
          ],
        },
        { $set: { bbox, cellSizeDeg, status: PLACES_SYNC_TILE_STATUS.SYNCING, startedAt: now } },
        { upsert: true, new: true }
      );
      return Boolean(claimed);
    } catch (error) {
      // The cell exists and matches none of the conditions above: up to date or being synced
      if (error.code === 11000) return false;
      throw error;
    }
  }

  /**
   * Record the outcome of a grid cell sync (creates the record for cells synced by the CLI)
   * @param {Object} tile - { key, bbox, cellSizeDeg }
   * @param {Object} result - { placesCount } on success, { error } on failure
   */
  async saveSyncTileResult({ key, bbox, cellSizeDeg }, { placesCount = 0, error } = {}) {
    const update = error
      ? { status: PLACES_SYNC_TILE_STATUS.FAILED, lastError: String(error).slice(0, 500) }
      : { status: PLACES_SYNC_TILE_STATUS.DONE, placesCount, syncedAt: new Date(), lastError: '' };
    await PlacesSyncTile.updateOne({ key }, { $set: { bbox, cellSizeDeg, ...update } }, { upsert: true });
  }

  /**
   * Number of these grid cells being synced right now (lock taken after lockStaleBefore)
   * @param {string[]} keys
   * @param {Date} lockStaleBefore
   * @returns {Promise<number>}
   */
  async countSyncingTiles(keys, lockStaleBefore) {
    return PlacesSyncTile.countDocuments({
      key: { $in: keys },
      status: PLACES_SYNC_TILE_STATUS.SYNCING,
      startedAt: { $gte: lockStaleBefore },
    });
  }

  async findById(id) {
    return PlacesCache.findById(id).lean();
  }

  async updateById(id, update) {
    return PlacesCache.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  }
}

export default new PlacesRepository();
