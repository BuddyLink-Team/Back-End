import axios from 'axios';
import logger from '../../shared/logger/index.js';

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const cache = new Map(); // key: "lat,lng" -> { data, fetchedAt }

/**
 * Open-Meteo Weather Integration (BUD-49 D2).
 * Free weather forecast API without requiring an API key.
 */
class OpenMeteoAdapter {
  /**
   * Get daily weather forecast for coordinates on a given date (YYYY-MM-DD).
   * @param {number} lat
   * @param {number} lng
   * @param {string} [dateStr] - YYYY-MM-DD
   * @returns {Promise<{ isRaining: boolean, precipitationProbability: number, weatherCode: number, maxTemp: number|null }>}
   */
  async getDailyWeather(lat, lng, dateStr) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { isRaining: false, precipitationProbability: 0, weatherCode: 0, maxTemp: null };
    }

    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLng = Math.round(lng * 100) / 100;
    const cacheKey = `${roundedLat},${roundedLng}`;

    let daily = null;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      daily = cached.daily;
    } else {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLng}&daily=weather_code,precipitation_probability_max,temperature_2m_max&timezone=Asia%2FHo_Chi_Minh`;
        const response = await axios.get(url, { timeout: 5000 });
        daily = response.data?.daily;
        if (daily) {
          cache.set(cacheKey, { daily, fetchedAt: Date.now() });
        }
      } catch (error) {
        logger.warn(`[OpenMeteoAdapter] Weather query failed: ${error.message}`);
        return { isRaining: false, precipitationProbability: 0, weatherCode: 0, maxTemp: null };
      }
    }

    if (!daily || !Array.isArray(daily.time)) {
      return { isRaining: false, precipitationProbability: 0, weatherCode: 0, maxTemp: null };
    }

    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    const index = daily.time.indexOf(targetDate);
    if (index === -1) {
      return { isRaining: false, precipitationProbability: 0, weatherCode: 0, maxTemp: null };
    }

    const code = daily.weather_code?.[index] ?? 0;
    const prob = daily.precipitation_probability_max?.[index] ?? 0;
    const maxTemp = daily.temperature_2m_max?.[index] ?? null;

    // Rain / drizzle / showers / thunderstorm WMO codes (>= 51) or precipitation prob > 50%
    const isRaining = code >= 51 || prob >= 50;

    return {
      isRaining,
      precipitationProbability: prob,
      weatherCode: code,
      maxTemp,
    };
  }
}

export const openMeteoAdapter = new OpenMeteoAdapter();
export default openMeteoAdapter;

