import placesService from './places.service.js';
import geminiAdapter from '../../integrations/ai/gemini.adapter.js';
import tavilyAdapter from '../../integrations/search/tavily.adapter.js';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ATTRACTION_SEARCH_PROVIDERS = Object.freeze({ TAVILY: 'tavily', GOOGLE: 'google' });

// The search did not run (no key, quota 429, network): the empty answer is not cached
const FAILED = Object.freeze({ attractions: [], failed: true });

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || ''));

// What the place is, in the words its own pages use
const SEARCH_LABELS = Object.freeze({ kids_cafe: 'kids cafe' });
const DEFAULT_SEARCH_LABEL = 'khu vui chơi trẻ em';

/**
 * A short query: name, kind of place, city (the last part of the address). The street and a long phrase
 * such as "trò chơi cho trẻ em" pull in "top places" articles instead of the pages of the place itself.
 * @param {{ name: string, address?: string, placeType?: string|null }} place
 * @returns {string}
 */
export const buildSearchQuery = ({ name, address = '', placeType = null }) => {
  const city = String(address).split(',').pop().trim();
  return [name, SEARCH_LABELS[placeType] || DEFAULT_SEARCH_LABEL, city].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
};

class PlaceAttractionsService {
  /**
   * Get attractions from cache (30-day TTL) or search the web (BUD-49 A4).
   * @param {string} placeId
   * @param {{ name: string, address?: string }} place
   * @returns {Promise<Array<{ title: string, description: string, sourceUrl?: string|null }>>}
   */
  async getOrFetchAttractions(placeId, { name, address = '' } = {}) {
    if (!placeId) return [];

    try {
      // Cache id or OpenStreetMap id: only a cached place can keep its attractions (30-day TTL)
      const doc = await placesService.getPlaceDocById(placeId);
      if (!doc) return [];
      if (doc.attractionsFetchedAt) {
        const age = Date.now() - new Date(doc.attractionsFetchedAt).getTime();
        if (age < CACHE_TTL_MS) {
          return doc.attractions || [];
        }
      }

      // Stale or not fetched yet
      const place = {
        name: name || doc.name,
        address: address || doc.address || '',
        website: doc.website || '',
        placeType: doc.placeType || null,
      };
      const result = await this._search(place);
      // A search that did not run is not cached: the next plan tries again
      if (result.failed) return [];

      // A search that ran is cached even when it found nothing, to respect the 30-day TTL
      await placesService.saveAttractions(doc._id, result.attractions);
      return result.attractions;
    } catch (error) {
      logger.warn(`[PlaceAttractionsService] getOrFetchAttractions failed for place=${placeId}: ${error.message}`);
      return [];
    }
  }

  /**
   * @private
   * @returns {Promise<{ attractions: Array<Object>, failed?: boolean }>}
   */
  async _search(place) {
    if (env.ATTRACTION_SEARCH.PROVIDER === ATTRACTION_SEARCH_PROVIDERS.GOOGLE) {
      const result = await geminiAdapter.searchPlaceAttractions({ placeName: place.name, address: place.address });
      if (!result || result.failed) return FAILED;
      return { attractions: result.hasGrounding ? result.attractions || [] : [] };
    }
    return this._searchWithTavily(place);
  }

  /**
   * Tavily finds the pages, a plain Gemini call reads the games out of them (works on the Gemini free tier).
   * The place's own website (from OpenStreetMap) is read when the search finds nothing.
   * @private
   */
  async _searchWithTavily(place) {
    if (!tavilyAdapter.isConfigured) {
      logger.warn('[PlaceAttractionsService] TAVILY_API_KEY is not set: no attraction search');
      return FAILED;
    }
    try {
      const query = buildSearchQuery(place);
      let sources = await tavilyAdapter.search(query);
      logger.info(`[PlaceAttractionsService] Tavily search "${query}": ${sources.length} page(s) ${sources.map((source) => source.url).join(', ')}`);
      if (!sources.length && isHttpUrl(place.website)) {
        sources = await tavilyAdapter.extract([place.website]);
        logger.info(`[PlaceAttractionsService] Tavily extract ${place.website}: ${sources.length} page(s)`);
      }
      if (!sources.length) return { attractions: [] };

      const attractions = await geminiAdapter.extractPlaceAttractions({
        placeName: place.name,
        address: place.address,
        sources,
      });
      logger.info(
        `[PlaceAttractionsService] "${place.name}": ${attractions.length} attraction(s) ` +
          attractions.map((attraction) => `${attraction.title} <${attraction.sourceUrl}>`).join(' | ')
      );
      return { attractions };
    } catch (error) {
      logger.warn(`[PlaceAttractionsService] Tavily attraction search failed for "${place.name}": ${error.message}`);
      return FAILED;
    }
  }
}

export const placeAttractionsService = new PlaceAttractionsService();
export default placeAttractionsService;
