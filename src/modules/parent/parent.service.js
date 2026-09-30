import parentRepository from './parent.repository.js';
import AppError from '../../shared/exceptions/AppError.js';
import { ParentProfileDTO } from './parent.dto.js';
import geocodingAdapter from '../../integrations/maps/geocoding.adapter.js';

class ParentService {
  async getParentByUserId(userId) {
    return parentRepository.findByUserId(userId);
  }

  async getParentById(id) {
    return parentRepository.findById(id);
  }

  async createParentProfile(data) {
    return parentRepository.create(data);
  }

  async updateVerification(userId, verificationUpdates) {
    return parentRepository.updateVerification(userId, verificationUpdates);
  }

  async updateOnboardingPreferences(userId, { location, preferences }) {
    const parent = await parentRepository.findByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    const updatePayload = {};
    if (location) {
      let coordinates = location.coordinates;

      // Nếu chưa có tọa độ hoặc đang là [0, 0], tự động geocode từ tên Phường/Xã và Tỉnh/Thành phố
      if (!coordinates || (coordinates[0] === 0 && coordinates[1] === 0)) {
        coordinates = await geocodingAdapter.getCoordinatesByAddress(
          location.area || location.address,
          location.city
        );
      }

      updatePayload.location = {
        ...(parent.location?.toObject?.() || parent.location),
        ...location,
        coordinates: {
          type: 'Point',
          coordinates,
        },
      };
    }

    if (preferences) {
      updatePayload.preferences = {
        ...parent.preferences?.toObject?.() || parent.preferences,
        ...preferences,
      };
    }

    const updatedParent = await parentRepository.updateByUserId(userId, updatePayload);
    return ParentProfileDTO.toResponse(updatedParent);
  }
}

export default new ParentService();
