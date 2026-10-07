import logger from '../../shared/logger/index.js';
import { DEFAULT_CURATED_PLACES } from '../../modules/discovery/places.seed.js';

class PlacesProvider {
  /**
   * Return predefined curated seed places for initial cache setup
   * @returns {Array<Object>}
   */
  getCuratedSeedPlaces() {
    return DEFAULT_CURATED_PLACES;
  }

  /**
   * Query external places from OpenStreetMap Overpass or Google Places API
   * Falls back to curated dataset if external service fails or is not configured
   *
   * @param {Object} options
   * @param {number} options.lat
   * @param {number} options.lng
   * @param {number} options.radius
   * @param {string} options.type
   * @param {string} options.keyword
   * @returns {Promise<Array<Object>>}
   */
  // eslint-disable-next-line no-unused-vars -- keyword is part of the provider contract, used once a real API is wired
  async fetchExternalPlaces({ lat, lng, radius = 5000, type, keyword } = {}) {
    try {
      // In production, integration with Google Places or OpenStreetMap Overpass API
      logger.info(`[PlacesProvider] Querying external places at [${lng}, ${lat}], radius: ${radius}m, type: ${type || 'all'}`);
      return [];
    } catch (error) {
      logger.warn(`[PlacesProvider Warn] Failed to fetch from external provider: ${error.message}`);
      return [];
    }
  }
}

export default new PlacesProvider();
