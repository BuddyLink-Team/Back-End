import PlacesCache from './places-cache.model.js';
import logger from '../../shared/logger/index.js';

/**
 * Escapes special regex characters to prevent ReDoS and regex injection attacks
 * @param {string} str
 * @returns {string}
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class PlacesRepository {
  /**
   * Count total places currently in the cache
   * @returns {Promise<number>}
   */
  async count() {
    return PlacesCache.countDocuments();
  }

  /**
   * Upsert a single place by its unique Google/OSM place identifier
   * @param {string} googlePlaceId
   * @param {Object} placeData
   * @returns {Promise<PlacesCache>}
   */
  async upsertPlace(googlePlaceId, placeData) {
    return PlacesCache.findOneAndUpdate(
      { googlePlaceId },
      { $set: placeData },
      { upsert: true, new: true }
    );
  }

  /**
   * Bulk upsert an array of places
   * @param {Array<Object>} places
   * @returns {Promise<void>}
   */
  async bulkUpsert(places) {
    if (!places || places.length === 0) return;
    const bulkOps = places.map((place) => ({
      updateOne: {
        filter: { googlePlaceId: place.googlePlaceId },
        update: { $set: place },
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
      const escaped = escapeRegex(searchTerm.trim());
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { address: { $regex: escaped, $options: 'i' } },
      ];
    }

    return query;
  }

  /**
   * Find nearby places using 2dsphere geospatial index
   * @param {Object} options
   * @param {number} options.latitude
   * @param {number} options.longitude
   * @param {number} options.radiusInMeters
   * @param {Object} options.filterQuery
   * @param {number} options.limit
   * @returns {Promise<Array<PlacesCache>>}
   */
  async findNearby({ latitude, longitude, radiusInMeters, filterQuery = {}, limit = 20 }) {
    try {
      return await PlacesCache.find({
        ...filterQuery,
        coordinates: {
          $nearSphere: {
            $geometry: {
              type: 'Point',
              coordinates: [longitude, latitude],
            },
            $maxDistance: radiusInMeters,
          },
        },
      }).limit(limit);
    } catch (geoError) {
      logger.error(`[PlacesRepository Error] Geospatial query failed: ${geoError.message}`, {
        latitude,
        longitude,
        radiusInMeters,
        geoError,
      });
      throw geoError;
    }
  }

  /**
   * Find places matching query criteria sorted by rating
   * @param {Object} options
   * @param {Object} options.filterQuery
   * @param {number} options.limit
   * @returns {Promise<Array<PlacesCache>>}
   */
  async findByFilter({ filterQuery = {}, limit = 20 }) {
    return PlacesCache.find(filterQuery).sort({ rating: -1 }).limit(limit);
  }
}

export default new PlacesRepository();
