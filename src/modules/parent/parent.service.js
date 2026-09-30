import bcrypt from 'bcryptjs';
import parentRepository from './parent.repository.js';
import userService from '../user/user.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { ParentProfileDTO } from './parent.dto.js';
import geocodingAdapter from '../../integrations/maps/geocoding.adapter.js';
import cloudinaryAdapter from '../../integrations/storage/cloudinary.adapter.js';

class ParentService {
  async getParentByUserId(userId) {
    return parentRepository.findByUserId(userId);
  }

  async getMyProfile(userId) {
    const [parent, user] = await Promise.all([
      parentRepository.findByUserId(userId),
      userService.getUserById(userId),
    ]);

    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    return ParentProfileDTO.toResponse(parent, user);
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
      const existingLoc = parent.location?.toObject?.() || parent.location || {};
      const area = location.area !== undefined ? location.area : existingLoc.area;
      const city = location.city !== undefined ? location.city : existingLoc.city;

      // Automatically construct address by joining area and city if not explicitly provided
      const resolvedAddress = location.address?.trim()
        ? location.address.trim()
        : [area, city].filter(Boolean).join(', ');

      let coordinates = location.coordinates;

      // Automatically geocode coordinates if missing or defaulted to [0, 0]
      if (!coordinates || (coordinates[0] === 0 && coordinates[1] === 0)) {
        coordinates = await geocodingAdapter.getCoordinatesByAddress(
          area || resolvedAddress,
          city
        );
      }

      updatePayload.location = {
        ...existingLoc,
        ...location,
        address: resolvedAddress,
        coordinates: {
          type: 'Point',
          coordinates: coordinates || existingLoc.coordinates?.coordinates || [0, 0],
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
    const user = await userService.getUserById(userId);
    return ParentProfileDTO.toResponse(updatedParent, user);
  }

  async updateProfile(userId, updateData) {
    const parent = await parentRepository.findByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    const updatePayload = {};

    if (updateData.fullName !== undefined) {
      updatePayload.fullName = updateData.fullName;
    }

    if (updateData.bio !== undefined) {
      updatePayload.bio = updateData.bio;
    }

    if (updateData.location) {
      const existingLoc = parent.location?.toObject?.() || parent.location || {};
      const area = updateData.location.area !== undefined ? updateData.location.area : existingLoc.area;
      const city = updateData.location.city !== undefined ? updateData.location.city : existingLoc.city;

      // Automatically construct address by joining area and city if not explicitly provided
      const resolvedAddress = updateData.location.address?.trim()
        ? updateData.location.address.trim()
        : [area, city].filter(Boolean).join(', ');

      let coordinates = updateData.location.coordinates;

      // Geocode when new address, area or city provided and coordinates are missing/zeroed
      const hasNewAddress = updateData.location.address || updateData.location.area || updateData.location.city;
      if (!coordinates && hasNewAddress) {
        coordinates = await geocodingAdapter.getCoordinatesByAddress(
          area || resolvedAddress,
          city
        );
      }

      updatePayload.location = {
        ...existingLoc,
        ...updateData.location,
        address: resolvedAddress,
        ...(coordinates ? { coordinates: { type: 'Point', coordinates } } : {}),
      };
    }

    if (updateData.preferences) {
      updatePayload.preferences = {
        ...(parent.preferences?.toObject?.() || parent.preferences),
        ...updateData.preferences,
      };
    }

    if (updateData.privacySettings) {
      updatePayload.privacySettings = {
        ...(parent.privacySettings?.toObject?.() || parent.privacySettings),
        ...updateData.privacySettings,
      };
    }

    const updatedParent = await parentRepository.updateByUserId(userId, updatePayload);
    const user = await userService.getUserById(userId);
    return ParentProfileDTO.toResponse(updatedParent, user);
  }

  async updateAvatar(userId, fileBuffer) {
    const parent = await parentRepository.findByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    if (!fileBuffer) {
      throw new AppError('Avatar image file is required', 400, 'AVATAR_FILE_REQUIRED');
    }

    const uploadResult = await cloudinaryAdapter.uploadImage(fileBuffer, {
      folder: 'buddylink/parents/avatars',
      transformation: [
        { width: 400, height: 400, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });

    const updatedParent = await parentRepository.updateByUserId(userId, {
      avatarUrl: uploadResult.url,
    });

    return {
      avatarUrl: updatedParent.avatarUrl,
    };
  }
}

export default new ParentService();
