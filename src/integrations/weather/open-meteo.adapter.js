import axios from 'axios';
import logger from '../../shared/logger/index.js';

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
// Longest forecast Open-Meteo gives (the default is 7 days)
const FORECAST_DAYS = 16;
// Rain / drizzle / showers / thunderstorm WMO codes start at 51
const RAIN_WEATHER_CODE = 51;
const RAIN_PROBABILITY = 50;
const cache = new Map(); // key: "lat,lng" -> { daily, fetchedAt }

/**
 * Open-Meteo Weather Integration (BUD-49 D2).
 * Free weather forecast API without requiring an API key.
 */
class OpenMeteoAdapter {
  /**
   * Get daily weather forecast for coordinates on a given date (YYYY-MM-DD).
   * Returns null when the weather is unknown: the lookup failed or the day is past the forecast,
   * so the caller never treats an unknown day as a dry one.
   * @param {number} lat
   * @param {number} lng
   * @param {string} [dateStr] - YYYY-MM-DD
   * @param {{ time?: string|null, durationMinutes?: number }} [slot] - Start "HH:mm" and length of the playdate:
   *   the forecast is then the one of those hours (scope 'slot') when the hourly forecast has them
   * @returns {Promise<{ isRaining: boolean, precipitationProbability: number, weatherCode: number, maxTemp: number|null, scope?: 'slot' }|null>}
   */
  async getDailyWeather(lat, lng, dateStr, { time = null, durationMinutes = 60 } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLng = Math.round(lng * 100) / 100;
    const cacheKey = `${roundedLat},${roundedLng}`;

    let daily = null;
    let hourly = null;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      ({ daily, hourly } = cached);
    } else {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLng}` +
          `&daily=weather_code,precipitation_probability_max,temperature_2m_max` +
          `&hourly=weather_code,precipitation_probability,temperature_2m` +
          `&timezone=Asia%2FHo_Chi_Minh&forecast_days=${FORECAST_DAYS}`;
        const response = await axios.get(url, { timeout: 5000 });
        daily = response.data?.daily;
        hourly = response.data?.hourly || null;
        if (daily) {
          cache.set(cacheKey, { daily, hourly, fetchedAt: Date.now() });
        }
      } catch (error) {
        logger.warn(`[OpenMeteoAdapter] Weather query failed: ${error.message}`);
        return null;
      }
    }

    if (!daily || !Array.isArray(daily.time)) return null;

    const targetDate = dateStr || new Date().toISOString().slice(0, 10);

    // The hours of the playdate when a start time is given: a shower at night is not rain at 9 a.m.
    const slot = this._slotWeather(hourly, targetDate, time, durationMinutes);
    if (slot) return slot;

    const index = daily.time.indexOf(targetDate);
    if (index === -1) return null;

    const code = daily.weather_code?.[index] ?? 0;
    const prob = daily.precipitation_probability_max?.[index] ?? 0;
    const maxTemp = daily.temperature_2m_max?.[index] ?? null;

    return {
      isRaining: code >= RAIN_WEATHER_CODE || prob >= RAIN_PROBABILITY,
      precipitationProbability: prob,
      weatherCode: code,
      maxTemp,
    };
  }

  /**
   * Forecast of the hours a playdate covers (worst weather code, highest chance of rain and temperature),
   * or null when the hourly forecast does not have them
   * @private
   * @param {Object|null} hourly - Open-Meteo hourly block
   * @param {string} date - YYYY-MM-DD
   * @param {string|null} time - Start "HH:mm"
   * @param {number} durationMinutes
   * @returns {{ isRaining: boolean, precipitationProbability: number, weatherCode: number, maxTemp: number|null, scope: 'slot' }|null}
   */
  _slotWeather(hourly, date, time, durationMinutes) {
    if (!hourly || !Array.isArray(hourly.time) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) return null;
    const [startHour, startMinute] = time.split(':').map(Number);
    const lastHour = Math.min(23, Math.floor((startHour * 60 + startMinute + Math.max(1, durationMinutes) - 1) / 60));
    const indexes = [];
    for (let hour = startHour; hour <= lastHour; hour += 1) {
      const index = hourly.time.indexOf(`${date}T${String(hour).padStart(2, '0')}:00`);
      if (index !== -1) indexes.push(index);
    }
    if (!indexes.length) return null;

    const highest = (values) => {
      const numbers = indexes.map((index) => values?.[index]).filter((value) => Number.isFinite(value));
      return numbers.length ? Math.max(...numbers) : null;
    };
    const code = highest(hourly.weather_code) ?? 0;
    const prob = highest(hourly.precipitation_probability) ?? 0;
    return {
      isRaining: code >= RAIN_WEATHER_CODE || prob >= RAIN_PROBABILITY,
      precipitationProbability: prob,
      weatherCode: code,
      maxTemp: highest(hourly.temperature_2m),
      scope: 'slot',
    };
  }
}

export const openMeteoAdapter = new OpenMeteoAdapter();
export default openMeteoAdapter;
