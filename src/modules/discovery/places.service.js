import placesRepository from './places.repository.js';
import placesProvider from '../../integrations/maps/places.provider.js';
import logger from '../../shared/logger/index.js';

let isSeedInitialized = false;

class PlacesService {
  /**
   * Initialize places cache from curated seed dataset once during startup
   * Does NOT execute on every user request
   * @returns {Promise<void>}
   */
  async initPlacesSeed() {
    if (isSeedInitialized) return;

    try {
      const count = await placesRepository.count();
      if (count === 0) {
        logger.info('[PlacesService] Cache empty, seeding initial places from curated dataset...');
        const seedPlaces = placesProvider.getCuratedSeedPlaces();
        await placesRepository.bulkUpsert(seedPlaces);
        logger.info(`[PlacesService] Seeded ${seedPlaces.length} places successfully.`);
      }
      isSeedInitialized = true;
    } catch (error) {
      logger.error(`[PlacesService Error] Failed to initialize places cache: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find nearby child-friendly places with category & keyword filters
   *
   * @param {Object} queryOptions
   * @param {number|string} [queryOptions.lat]
   * @param {number|string} [queryOptions.lng]
   * @param {number|string} [queryOptions.radius=5000]
   * @param {string} [queryOptions.type]
   * @param {string} [queryOptions.keyword]
   * @param {string} [queryOptions.search]
   * @param {number|string} [queryOptions.limit=20]
   * @returns {Promise<Array<Object>>}
   */
  async getNearbyPlaces({ lat, lng, radius = 5000, type, keyword, search, limit = 20 } = {}) {
    // Ensure cache has been initialized at least once without re-counting on every request
    if (!isSeedInitialized) {
      await this.initPlacesSeed();
    }

    const searchTerm = (keyword || search || '').trim();
    const filterQuery = placesRepository.buildFilterQuery({ type, searchTerm });
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    let places = [];

    // Geospatial search if coordinates are present
    const hasCoordinates =
      lat !== undefined &&
      lng !== undefined &&
      !isNaN(parseFloat(lat)) &&
      !isNaN(parseFloat(lng));

    if (hasCoordinates) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);
      const radInMeters = parseInt(radius, 10) || 5000;

      places = await placesRepository.findNearby({
        latitude,
        longitude,
        radiusInMeters: radInMeters,
        filterQuery,
        limit: parsedLimit,
      });
    } else {
      places = await placesRepository.findByFilter({
        filterQuery,
        limit: parsedLimit,
      });
    }

    return places.map((p) => ({
      id: p._id.toString(),
      placeId: p.googlePlaceId,
      name: p.name,
      address: p.address,
      placeType: p.placeType,
      coordinates: p.coordinates?.coordinates || [0, 0], // [lng, lat]
      rating: p.rating || 0,
      userRatingsTotal: p.userRatingsTotal || 0,
    }));
  }
}

export default new PlacesService();
