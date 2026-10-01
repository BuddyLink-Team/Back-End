import PlacesCache from './places-cache.model.js';
import { PLACE_TYPES } from './discovery.constants.js';

// Pre-curated family & kid-friendly places in Vietnam for OpenStreetMap/Google Places cache
const DEFAULT_CURATED_PLACES = [
  {
    googlePlaceId: 'place_park_giadinh',
    name: 'Công viên Gia Định',
    address: 'Đường Hoàng Minh Giám, Phường 3, Quận Gò Vấp, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.PARK,
    coordinates: { type: 'Point', coordinates: [106.6741, 10.8144] },
    rating: 4.6,
    userRatingsTotal: 3420,
  },
  {
    googlePlaceId: 'place_park_cuanhsao',
    name: 'Công viên Cầu Ánh Sao - Hồ Bán Nguyệt',
    address: 'Khu đô thị Phú Mỹ Hưng, Phường Tân Phú, Quận 7, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.PARK,
    coordinates: { type: 'Point', coordinates: [106.7196, 10.7267] },
    rating: 4.8,
    userRatingsTotal: 4890,
  },
  {
    googlePlaceId: 'place_park_thaocamvien',
    name: 'Thảo Cầm Viên Sài Gòn',
    address: 'Số 2 Nguyễn Bỉnh Khiêm, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.PARK,
    coordinates: { type: 'Point', coordinates: [106.7051, 10.7875] },
    rating: 4.5,
    userRatingsTotal: 8900,
  },
  {
    googlePlaceId: 'place_park_taodan',
    name: 'Công viên Tao Đàn',
    address: 'Đường Trương Định, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.PARK,
    coordinates: { type: 'Point', coordinates: [106.6917, 10.7744] },
    rating: 4.4,
    userRatingsTotal: 2850,
  },
  {
    googlePlaceId: 'place_cafe_kawaii',
    name: 'Kawaii Family & Kids Cafe',
    address: 'Số 2-4 Đường số 1, KDC Him Lam, Tân Hưng, Quận 7, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.KIDS_CAFE,
    coordinates: { type: 'Point', coordinates: [106.6998, 10.7495] },
    rating: 4.7,
    userRatingsTotal: 310,
  },
  {
    googlePlaceId: 'place_cafe_dodam',
    name: 'Dodam Dodam Premium Kids Cafe',
    address: 'Tầng 2 The Manor Officetel, 91 Nguyễn Hữu Cảnh, Bình Thạnh, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.KIDS_CAFE,
    coordinates: { type: 'Point', coordinates: [106.7192, 10.7891] },
    rating: 4.8,
    userRatingsTotal: 245,
  },
  {
    googlePlaceId: 'place_cafe_lalaland',
    name: 'Lalaland Premium Kids Club & Cafe',
    address: 'Số 86 Nguyễn Thị Thập, Khu đô thị Him Lam, Quận 7, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.KIDS_CAFE,
    coordinates: { type: 'Point', coordinates: [106.7025, 10.7412] },
    rating: 4.6,
    userRatingsTotal: 180,
  },
  {
    googlePlaceId: 'place_playground_tiniworld_crescent',
    name: 'Khu vui chơi TiNiWorld Crescent Mall',
    address: 'Tầng 5 Crescent Mall, 101 Tôn Dật Tiên, Tân Phú, Quận 7, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.PLAYGROUND,
    coordinates: { type: 'Point', coordinates: [106.7188, 10.7291] },
    rating: 4.6,
    userRatingsTotal: 2150,
  },
  {
    googlePlaceId: 'place_playground_kizciti',
    name: 'Thành phố Hướng nghiệp KizCiti',
    address: 'Công viên Khánh Hội, Đường Hoàng Diệu, Phường 5, Quận 4, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.PLAYGROUND,
    coordinates: { type: 'Point', coordinates: [106.7011, 10.7602] },
    rating: 4.3,
    userRatingsTotal: 1540,
  },
  {
    googlePlaceId: 'place_playground_jumparena',
    name: 'Khu vui chơi bạt nhún Jump Arena Him Lam',
    address: 'Khuôn viên Vietopia, Số 2-4 Đường số 9, Tân Hưng, Quận 7, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.SPORTS_CENTER,
    coordinates: { type: 'Point', coordinates: [106.6987, 10.7481] },
    rating: 4.5,
    userRatingsTotal: 1220,
  },
  {
    googlePlaceId: 'place_lib_general',
    name: 'Thư viện Khoa học Tổng hợp TP.HCM',
    address: '69 Lý Tự Trọng, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.LIBRARY,
    coordinates: { type: 'Point', coordinates: [106.6989, 10.7761] },
    rating: 4.7,
    userRatingsTotal: 980,
  },
  {
    googlePlaceId: 'place_workshop_vincom',
    name: 'Trung tâm Nghệ thuật & Sáng tạo Vincom Center',
    address: '72 Lê Thánh Tôn, Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    placeType: PLACE_TYPES.WORKSHOP,
    coordinates: { type: 'Point', coordinates: [106.7019, 10.7781] },
    rating: 4.6,
    userRatingsTotal: 430,
  },
];

class PlacesService {
  /**
   * Seed initial places into cache if empty
   */
  async seedInitialPlacesIfEmpty() {
    const count = await PlacesCache.countDocuments();
    if (count === 0) {
      for (const place of DEFAULT_CURATED_PLACES) {
        await PlacesCache.findOneAndUpdate(
          { googlePlaceId: place.googlePlaceId },
          { $set: place },
          { upsert: true, new: true }
        );
      }
    }
  }

  /**
   * Find nearby child-friendly places with category & keyword filters
   * Adapter supporting OpenStreetMap/Google Places schema
   */
  async getNearbyPlaces({ lat, lng, radius = 5000, type, keyword, search, limit = 20 } = {}) {
    await this.seedInitialPlacesIfEmpty();

    const query = {};

    // Filter by place category
    if (type && type !== 'all') {
      query.placeType = type.toLowerCase();
    }

    // Filter by keyword or search term
    const searchTerm = (keyword || search || '').trim();
    if (searchTerm) {
      query.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { address: { $regex: searchTerm, $options: 'i' } },
      ];
    }

    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    let places = [];

    // Geospatial search if coordinates are valid numbers
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const hasCoordinates = !isNaN(latitude) && !isNaN(longitude);

    if (hasCoordinates) {
      try {
        const radInMeters = parseInt(radius, 10) || 5000;
        places = await PlacesCache.find({
          ...query,
          coordinates: {
            $nearSphere: {
              $geometry: {
                type: 'Point',
                coordinates: [longitude, latitude],
              },
              $maxDistance: radInMeters,
            },
          },
        }).limit(parsedLimit);
      } catch (geoError) {
        // Fallback to regular query if geospatial index/coordinates are not ready
        places = await PlacesCache.find(query).sort({ rating: -1 }).limit(parsedLimit);
      }
    } else {
      places = await PlacesCache.find(query).sort({ rating: -1 }).limit(parsedLimit);
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
