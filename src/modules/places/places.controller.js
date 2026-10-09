import placesService from './places.service.js';
import { successResponse } from '../../shared/response/index.js';

class PlacesController {
  /**
   * GET /api/v1/places/nearby
   */
  async getNearbyPlaces(req, res, next) {
    try {
      const { places, areaSyncing } = await placesService.getNearbyPlaces(req.userId, req.query);
      // areaSyncing: places of this area are being fetched in the background, search again shortly
      return successResponse(res, places, 'Nearby places retrieved successfully', 200, { areaSyncing });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/v1/places/:id
   */
  async getPlaceById(req, res, next) {
    try {
      const place = await placesService.getPlaceById(req.userId, req.params.id);
      return successResponse(res, place, 'Place retrieved successfully', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new PlacesController();
