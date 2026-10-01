import placesService from './places.service.js';
import { successResponse } from '../../shared/response/index.js';

class PlacesController {
  /**
   * GET /api/v1/places/nearby
   */
  async getNearbyPlaces(req, res, next) {
    try {
      const places = await placesService.getNearbyPlaces(req.query);
      return successResponse(res, places, 'Lấy danh sách địa điểm lân cận thành công', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new PlacesController();
