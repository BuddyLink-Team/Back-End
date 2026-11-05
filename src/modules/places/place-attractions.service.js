import placesService from './places.service.js';
import geminiAdapter from '../../integrations/ai/gemini.adapter.js';
import logger from '../../shared/logger/index.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class PlaceAttractionsService {
  /**
   * Get attractions from cache (30-day TTL) or search via Google Search Grounding (BUD-49 A4).
   * @param {string} placeId
   * @param {{ name: string, address?: string }} place
   * @returns {Promise<Array<{ title: string, description: string, sourceUrl?: string|null }>>}
   */
  async getOrFetchAttractions(placeId, { name, address = '' } = {}) {
    if (!placeId) return [];

    try {
      const doc = await placesService.getPlaceDocById(placeId);
      if (doc && doc.attractionsFetchedAt) {
        const age = Date.now() - new Date(doc.attractionsFetchedAt).getTime();
        if (age < CACHE_TTL_MS) {
          return doc.attractions || [];
        }
      }

      // Stale or not fetched yet: call Gemini search
      const result = await geminiAdapter.searchPlaceAttractions({ placeName: name, address });
      const attractions = result.attractions || [];

      // Always save to cache (even if empty, to respect the 30-day TTL and avoid redundant requests)
      await placesService.saveAttractions(placeId, attractions);
      return attractions;
    } catch (error) {
      logger.warn(`[PlaceAttractionsService] getOrFetchAttractions failed for place=${placeId}: ${error.message}`);
      return [];
    }
  }
}

export const placeAttractionsService = new PlaceAttractionsService();
export default placeAttractionsService;

