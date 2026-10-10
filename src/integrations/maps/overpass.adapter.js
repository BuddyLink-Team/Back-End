import axios from 'axios';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import { wait } from '../../shared/helpers/async.helper.js';
import { PLACE_TYPES } from '../../modules/places/places.constants.js';

/**
 * OpenStreetMap tags of each place type (Overpass QL filters), in classification order.
 * A kids cafe has no dedicated OSM tag: indoor play areas plus cafes named for children.
 */
const TYPE_FILTERS = Object.freeze({
  [PLACE_TYPES.PARK]: ['["leisure"="park"]'],
  [PLACE_TYPES.PLAYGROUND]: ['["leisure"="playground"]', '["tourism"="theme_park"]'],
  [PLACE_TYPES.KIDS_CAFE]: ['["leisure"="indoor_play"]', '["amenity"="cafe"]["name"~"kid|trẻ em|thiếu nhi",i]'],
  [PLACE_TYPES.LIBRARY]: ['["amenity"="library"]'],
  [PLACE_TYPES.SPORTS_CENTER]: ['["leisure"="sports_centre"]', '["leisure"="swimming_pool"]["access"!="private"]'],
  [PLACE_TYPES.WORKSHOP]: ['["amenity"="arts_centre"]', '["tourism"="museum"]'],
});

const KIDS_NAME_REGEX = /kid|trẻ em|thiếu nhi/i;
// Public instances answer 429 / 504 when busy: worth retrying after a pause
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/**
 * Place type of an OSM element from its tags (null when it is not a supported kid-friendly place)
 * @param {Object} tags
 * @returns {string|null}
 */
export const classifyPlaceType = (tags = {}) => {
  if (tags.leisure === 'park') return PLACE_TYPES.PARK;
  if (tags.leisure === 'playground' || tags.tourism === 'theme_park') return PLACE_TYPES.PLAYGROUND;
  if (tags.leisure === 'indoor_play' || (tags.amenity === 'cafe' && KIDS_NAME_REGEX.test(tags.name || ''))) {
    return PLACE_TYPES.KIDS_CAFE;
  }
  if (tags.amenity === 'library') return PLACE_TYPES.LIBRARY;
  if (tags.leisure === 'sports_centre' || tags.leisure === 'swimming_pool') return PLACE_TYPES.SPORTS_CENTER;
  if (tags.amenity === 'arts_centre' || tags.tourism === 'museum') return PLACE_TYPES.WORKSHOP;
  return null;
};

/**
 * Address from the OSM addr:* tags ('' when the element has none)
 * @param {Object} tags
 * @returns {string}
 */
export const buildAddressFromTags = (tags = {}) => {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const parts = [
    street,
    tags['addr:quarter'] || tags['addr:suburb'],
    tags['addr:district'],
    tags['addr:city'] || tags['addr:province'],
  ].filter(Boolean);
  return [...new Set(parts)].join(', ');
};

/**
 * Overpass QL query for every kid-friendly place inside a bounding box.
 * The global [bbox] lets Overpass use its spatial index first.
 * @param {Object} options
 * @param {[number, number, number, number]} options.bbox - [south, west, north, east]
 * @param {string} [options.type] - one PLACE_TYPES value, all types when omitted
 * @param {number} [options.timeoutSec=25] - server-side query timeout
 * @returns {string}
 */
export const buildAreaQuery = ({ bbox, type, timeoutSec = 25 }) => {
  const types = type && TYPE_FILTERS[type] ? [type] : Object.keys(TYPE_FILTERS);
  const selectors = types
    .flatMap((t) => TYPE_FILTERS[t])
    .map((filter) => `  nwr${filter}["name"];`)
    .join('\n');
  const box = bbox.map((v) => Number(v).toFixed(5)).join(',');
  return `[out:json][timeout:${timeoutSec}][bbox:${box}];\n(\n${selectors}\n);\nout center tags;`;
};

/**
 * Map an Overpass element to a places_cache document (null when unusable)
 * @param {Object} element
 * @returns {Object|null}
 */
export const mapElementToPlace = (element) => {
  const tags = element?.tags || {};
  const name = (tags['name:vi'] || tags.name || '').trim();
  const lat = element?.lat ?? element?.center?.lat;
  const lng = element?.lon ?? element?.center?.lon;
  const placeType = classifyPlaceType(tags);
  if (!name || !placeType || typeof lat !== 'number' || typeof lng !== 'number') return null;

  return {
    osmId: `osm-${element.type}-${element.id}`,
    name,
    address: buildAddressFromTags(tags),
    placeType,
    coordinates: { type: 'Point', coordinates: [lng, lat] },
    openingHours: tags.opening_hours || '',
    phone: tags.phone || tags['contact:phone'] || '',
    website: tags.website || tags['contact:website'] || '',
    lastFetchedAt: new Date(),
  };
};

class OverpassAdapter {
  get isEnabled() {
    return env.OVERPASS.ENABLED;
  }

  /**
   * Run a query on the configured instances in order, retrying busy answers (429 / 5xx / timeout)
   * with an increasing pause.
   * @param {string} query
   * @param {Object} [options]
   * @param {number} [options.timeoutMs] - HTTP timeout per attempt
   * @param {number} [options.retries=0] - extra rounds over every instance
   * @param {number} [options.retryDelayMs=10000] - pause before the first retry (doubled each round)
   */
  async _run(query, { timeoutMs = env.OVERPASS.TIMEOUT_MS, retries = 0, retryDelayMs = 10000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await wait(retryDelayMs * 2 ** (attempt - 1));
      for (const url of env.OVERPASS.API_URLS) {
        try {
          const response = await axios.post(url, `data=${encodeURIComponent(query)}`, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              // The public instances reject anonymous clients (HTTP 406)
              'User-Agent': 'BuddyLinkApp/1.0 (contact@buddylink.vn)',
            },
            timeout: timeoutMs,
          });
          // A query that ran out of time still answers 200 with a "remark"
          if (response.data?.remark && !response.data.elements?.length) throw new Error(response.data.remark);
          const elements = Array.isArray(response.data?.elements) ? response.data.elements : [];
          return elements.map(mapElementToPlace).filter(Boolean);
        } catch (error) {
          lastError = error;
          logger.warn(`[Overpass] ${url} failed: ${error.message}`);
          const status = error.response?.status;
          if (status && !RETRYABLE_STATUS.has(status)) throw error;
        }
      }
    }
    throw lastError || new Error('No Overpass instance configured');
  }

  /**
   * Every kid-friendly place of a bounding box from OpenStreetMap (free, no API key).
   * Used by the places sync (scripts/sync-places.js), never while a user is waiting.
   * @param {[number, number, number, number]} bbox - [south, west, north, east]
   * @param {Object} [options] - timeoutMs, retries, retryDelayMs (see _run)
   * @returns {Promise<Array<Object>>} places_cache documents
   */
  async searchArea(bbox, options = {}) {
    if (!this.isEnabled) return [];
    const timeoutSec = Math.max(25, Math.round((options.timeoutMs || env.OVERPASS.TIMEOUT_MS) / 1000));
    logger.info(`[Overpass] Places in bbox [${bbox.join(', ')}]`);
    return this._run(buildAreaQuery({ bbox, timeoutSec }), options);
  }

  /**
   * One OSM element by its cache id ("osm-node-123", "osm-way-456", "osm-relation-789")
   * @param {string} osmId
   * @returns {Promise<Object|null>}
   */
  async getByOsmId(osmId) {
    if (!this.isEnabled) return null;
    const match = /^osm-(node|way|relation)-(\d+)$/.exec(osmId || '');
    if (!match) return null;
    const [, type, id] = match;
    const places = await this._run(`[out:json][timeout:25];\n${type}(${id});\nout center tags;`);
    return places[0] || null;
  }
}

export default new OverpassAdapter();
