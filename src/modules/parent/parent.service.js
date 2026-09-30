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
      let coordinates = location.coordinates;

      // Automatically geocode coordinates if missing or defaulted to [0, 0]
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
      let coordinates = updateData.location.coordinates;

      // Geocode when new address or city provided and coordinates are missing/zeroed
      const hasNewAddress = updateData.location.address || updateData.location.area || updateData.location.city;
      if (!coordinates && hasNewAddress) {
        coordinates = await geocodingAdapter.getCoordinatesByAddress(
          updateData.location.area || updateData.location.address,
          updateData.location.city
        );
      }

      updatePayload.location = {
        ...(parent.location?.toObject?.() || parent.location),
        ...updateData.location,
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

  async changePassword(userId, { currentPassword, newPassword, confirmNewPassword }) {
    if (newPassword !== confirmNewPassword) {
      throw new AppError('Confirmation password does not match', 400, 'PASSWORD_MISMATCH');
    }

    const user = await userService.getUserById(userId);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (!user.passwordHash) {
      throw new AppError(
        'Account was registered using a social provider (Google). Password cannot be changed this way.',
        400,
        'SOCIAL_ACCOUNT_NO_PASSWORD'
      );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Incorrect current password', 400, 'INVALID_CURRENT_PASSWORD');
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) {
      throw new AppError('New password cannot be the same as the current password', 400, 'SAME_AS_OLD_PASSWORD');
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await userService.updatePassword(userId, newPasswordHash);

    return { success: true };
  }
}

export default new ParentService();
