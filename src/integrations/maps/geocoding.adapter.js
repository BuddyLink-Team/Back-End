import axios from 'axios';
import logger from '../../shared/logger/index.js';

/**
 * Tọa độ tâm dự phòng của các tỉnh/thành phố lớn tại Việt Nam [lng, lat]
 * Chuẩn định dạng GeoJSON: [longitude, latitude]
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
   * Lấy tọa độ [lng, lat] từ tên Phường/Xã và Tỉnh/Thành phố
   * Sử dụng OpenStreetMap Nominatim API (Hoàn toàn miễn phí, không yêu cầu thẻ tín dụng/API Key)
   *
   * @param {string} area - Phường/Xã
   * @param {string} city - Tỉnh/Thành phố
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
      logger.info(`[Geocoding] Đang truy vấn tọa độ cho: "${query}" qua OpenStreetMap Nominatim...`);

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
            `[Geocoding Success] "${query}" -> [lng: ${lon}, lat: ${lat}] (Địa chỉ nhận diện: ${item.display_name})`
          );
          return [lon, lat];
        }
      }

      logger.warn(`[Geocoding Warn] Không tìm thấy kết quả từ OSM cho "${query}", sử dụng fallback.`);
    } catch (error) {
      logger.warn(
        `[Geocoding Warn] Lỗi khi gọi OpenStreetMap API: ${error.message}. Chuyển sang dùng tọa độ dự phòng.`
      );
    }

    // Fallback: Tìm theo tên Tỉnh/Thành phố trong danh sách tọa độ có sẵn
    const normalizedCity = cleanCity.toLowerCase();
    for (const [key, coords] of Object.entries(DEFAULT_CITY_COORDINATES)) {
      if (normalizedCity.includes(key)) {
        logger.info(`[Geocoding Fallback] Gán tọa độ trung tâm thành phố "${cleanCity}": [${coords}]`);
        return coords;
      }
    }

    // Mặc định trung tâm TP.HCM nếu không khớp
    return [106.6297, 10.8231];
  }
}

export default new GeocodingAdapter();
