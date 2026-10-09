import axios from 'axios';
import logger from '../../shared/logger/index.js';

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

class GeocodingAdapter {
  /**
   * Resolve [lng, lat] from a ward/district and a province/city name.
   * Uses the OpenStreetMap Nominatim API (free, no API key or billing required).
   *
   * @param {string} area - Ward / district
   * @param {string} city - Province / city
   * @returns {Promise<[number, number]>} [longitude, latitude]
   */
  async getCoordinatesByAddress(area, city) {
    const cleanArea = (area || '').trim();
    const cleanCity = (city || '').trim();
    const query = [cleanArea, cleanCity, 'Việt Nam'].filter(Boolean).join(', ');

    if (!cleanArea && !cleanCity) {
      return [106.6297, 10.8231]; // Default TP.HCM
    }

    try {
      logger.info(`[Geocoding] Querying OpenStreetMap Nominatim for "${query}"`);

      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: query,
          format: 'json',
          limit: 1,
          addressdetails: 1,
        },
        headers: {
          'User-Agent': 'BuddyLinkApp/1.0 (contact@buddylink.vn)',
          'Accept-Language': 'vi',
        },
        timeout: 6000,
      });

      if (response.data && response.data.length > 0) {
        const item = response.data[0];
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);

        if (!isNaN(lat) && !isNaN(lon)) {
          logger.info(
            `[Geocoding Success] "${query}" -> [lng: ${lon}, lat: ${lat}] (matched: ${item.display_name})`
          );
          return [lon, lat];
        }
      }

      logger.warn(`[Geocoding Warn] No OSM result for "${query}", using fallback coordinates`);
    } catch (error) {
      logger.warn(
        `[Geocoding Warn] OpenStreetMap request failed: ${error.message}. Using fallback coordinates`
      );
    }

    // Fallback: match by city/province name in the predefined coordinates map
    const normalizedCity = cleanCity.toLowerCase();
    for (const [key, coords] of Object.entries(DEFAULT_CITY_COORDINATES)) {
      if (normalizedCity.includes(key)) {
        logger.info(`[Geocoding Fallback] Using fallback coordinates for "${cleanCity}": [${coords}]`);
        return coords;
      }
    }

    // Default to Ho Chi Minh City coordinates if no match is found
    return [106.6297, 10.8231];
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
      const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
        params: { lat, lon: lng, format: 'json', zoom: 18, addressdetails: 1 },
        headers: {
          'User-Agent': 'BuddyLinkApp/1.0 (contact@buddylink.vn)',
          'Accept-Language': 'vi',
        },
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
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: name, format: 'json', limit: 1, countrycodes: 'vn' },
      headers: {
        'User-Agent': 'BuddyLinkApp/1.0 (contact@buddylink.vn)',
        'Accept-Language': 'vi',
      },
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
