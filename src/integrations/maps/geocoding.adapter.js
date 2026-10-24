import axios from 'axios';
import logger from '../../shared/logger/index.js';
import { publicDnsHttpsAgent } from './public-dns.agent.js';

/**
 * Fallback center coordinates of major Vietnamese provinces/cities.
 * GeoJSON order: [longitude, latitude]. Keys are lower-case Vietnamese names matched against user input.
 */
const DEFAULT_CITY_COORDINATES = {
  'hồ chí minh': [106.6297, 10.8231],
  'tp.hcm': [106.6297, 10.8231],
  'hcm': [106.6297, 10.8231],
  'hà nội': [105.8542, 21.0285],
  'đà nẵng': [108.2022, 16.0544],
  'hải phòng': [106.6881, 20.8449],
  'cần thơ': [105.7844, 10.0452],
  'bình dương': [106.6667, 11.0000],
  'đồng nai': [107.0000, 11.0000],
  'bà rịa': [107.1667, 10.5000],
  'vũng tàu': [107.1667, 10.5000],
  'khánh hòa': [109.1967, 12.2388],
  'nha trang': [109.1967, 12.2388],
  'lâm đồng': [108.4419, 11.9404],
  'đà lạt': [108.4419, 11.9404],
  'quảng ninh': [107.0734, 20.9505],
  'huế': [107.5909, 16.4637],
};

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_POINT = [106.6297, 10.8231]; // TP.HCM
// Nominatim allows 1 request per second
const NOMINATIM_INTERVAL_MS = 1100;

// Address types of a ward / commune boundary (Điện Bàn is a "town", most city wards are "suburb")
const WARD_ADDRESS_TYPES = new Set(['suburb', 'quarter', 'neighbourhood', 'village', 'town', 'hamlet', 'city_district', 'municipality']);

const isAdministrative = (item) => item?.class === 'boundary' && item?.type === 'administrative';
const isWardBoundary = (item) => isAdministrative(item) && WARD_ADDRESS_TYPES.has(item.addresstype);
const toPoint = (item) => {
  const point = [parseFloat(item.lon), parseFloat(item.lat)];
  return point.every(Number.isFinite) ? point : null;
};
const normalize = (text = '') => text.trim().toLowerCase();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GeocodingAdapter {
  constructor() {
    // Public DNS: some router / ISP resolvers do not resolve nominatim.openstreetmap.org
    this.client = axios.create({
      baseURL: NOMINATIM_URL,
      headers: {
        'User-Agent': 'BuddyLinkApp/1.0 (contact@buddylink.vn)',
        'Accept-Language': 'vi',
      },
      httpsAgent: publicDnsHttpsAgent,
    });
    // Pause before a second Nominatim request of the same lookup (tests set it to 0)
    this.requestIntervalMs = NOMINATIM_INTERVAL_MS;
  }

  /**
   * Nominatim search results (address details included), Vietnam only
   * @param {string} query
   * @returns {Promise<Array<Object>>}
   */
  async _search(query) {
    const response = await this.client.get('/search', {
      params: { q: query, format: 'json', limit: 5, addressdetails: 1, countrycodes: 'vn' },
      timeout: 6000,
    });
    return Array.isArray(response.data) ? response.data : [];
  }

  /**
   * Resolve [lng, lat] from a ward and a province/city name: the center of the ward's administrative
   * boundary (OpenStreetMap Nominatim, free, no API key). Wards follow the units in force since 07/2025.
   * - A ward name from before the 07/2025 merge matches no boundary: Nominatim then finds something inside
   *   it (e.g. a police station), whose address names the new ward; the new ward's center is used.
   * - Without a ward (or when nothing is found) the city center is used, and a warning is logged.
   *
   * @param {string} area - Ward / commune
   * @param {string} city - Province / city
   * @returns {Promise<[number, number]>} [longitude, latitude]
   */
  async getCoordinatesByAddress(area, city) {
    const cleanArea = (area || '').trim();
    const cleanCity = (city || '').trim();
    const query = [cleanArea, cleanCity, 'Việt Nam'].filter(Boolean).join(', ');

    if (!cleanArea && !cleanCity) {
      return DEFAULT_POINT;
    }

    try {
      const results = await this._search(query);

      if (!cleanArea) {
        // City only: the center of the city / province boundary
        const cityBoundary = results.find(isAdministrative);
        if (cityBoundary && toPoint(cityBoundary)) return toPoint(cityBoundary);
      } else {
        const ward = results.find(isWardBoundary);
        if (ward && toPoint(ward)) {
          logger.info(`[Geocoding] "${query}" -> ward "${ward.name}" [${toPoint(ward)}]`);
          return toPoint(ward);
        }

        // Former ward name: use the new ward its results now belong to
        const newWardName = results
          .map((item) => item.address?.suburb || item.address?.quarter || item.address?.city_district)
          .find((name) => name && normalize(name) !== normalize(cleanArea));
        if (newWardName) {
          await wait(this.requestIntervalMs);
          const newWard = (await this._search([newWardName, cleanCity, 'Việt Nam'].filter(Boolean).join(', '))).find(
            isWardBoundary
          );
          if (newWard && toPoint(newWard)) {
            logger.info(`[Geocoding] "${cleanArea}" is now part of "${newWard.name}" -> [${toPoint(newWard)}]`);
            return toPoint(newWard);
          }
        }
      }

      logger.warn(`[Geocoding Warn] No ward boundary found for "${query}", using the city center`);
    } catch (error) {
      logger.warn(`[Geocoding Warn] OpenStreetMap request failed for "${query}": ${error.message}. Using the city center`);
    }

    // Fallback: match by city/province name in the predefined coordinates map
    const normalizedCity = cleanCity.toLowerCase();
    for (const [key, coords] of Object.entries(DEFAULT_CITY_COORDINATES)) {
      if (normalizedCity.includes(key)) {
        logger.warn(`[Geocoding Fallback] "${query}" placed at the center of "${key}": distances from it are approximate`);
        return coords;
      }
    }

    logger.warn(`[Geocoding Fallback] Unknown city "${cleanCity}", "${query}" placed at the default point (TP.HCM)`);
    return DEFAULT_POINT;
  }

  /**
   * Readable address of a point with OpenStreetMap Nominatim reverse geocoding.
   * Used once per place (the result is cached), so the 1 request/second policy is respected.
   *
   * @param {number} lng
   * @param {number} lat
   * @returns {Promise<string>} '' when nothing is found or the request fails
   */
  async reverseGeocode(lng, lat) {
    try {
      const response = await this.client.get('/reverse', {
        params: { lat, lon: lng, format: 'json', zoom: 18, addressdetails: 1 },
        timeout: 6000,
      });
      const address = response.data?.address || {};
      const street = [address.house_number, address.road].filter(Boolean).join(' ');
      const parts = [
        street,
        address.quarter || address.suburb || address.neighbourhood,
        address.city_district,
        address.city || address.town || address.state,
      ].filter(Boolean);
      return [...new Set(parts)].join(', ') || response.data?.display_name || '';
    } catch (error) {
      logger.warn(`[Geocoding Warn] Reverse geocoding failed for [${lng}, ${lat}]: ${error.message}`);
      return '';
    }
  }

  /**
   * Bounding box of a place name in Vietnam with OpenStreetMap Nominatim (places sync --city)
   *
   * @param {string} name - city / district / province, e.g. "Huế", "Quận 7, TP. Hồ Chí Minh"
   * @returns {Promise<{ label: string, bbox: [number, number, number, number] }|null>}
   *   bbox is [south, west, north, east], null when nothing is found
   */
  async getBoundingBox(name) {
    const response = await this.client.get('/search', {
      params: { q: name, format: 'json', limit: 1, countrycodes: 'vn' },
      timeout: 10000,
    });
    const item = response.data?.[0];
    // Nominatim order: [south, north, west, east]
    const [south, north, west, east] = (item?.boundingbox || []).map(Number);
    if (![south, north, west, east].every(Number.isFinite)) return null;
    return { label: item.display_name, bbox: [south, west, north, east] };
  }
}

export default new GeocodingAdapter();
