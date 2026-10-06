import parentRepository from "./parent.repository.js";
import AppError from "../../shared/exceptions/AppError.js";
import { ParentProfileDTO } from "./parent.dto.js";
import { PREFERENCE_LIMITS } from "./parent.constants.js";
import geocodingAdapter from "../../integrations/maps/geocoding.adapter.js";
import storageAdapter from "../../integrations/storage/storage.adapter.js";

/**
 * Validate a GeoJSON [longitude, latitude] pair; invalid values would break the 2dsphere index.
 */
const assertValidCoordinates = (coordinates) => {
  if (coordinates === undefined || coordinates === null) return;

  const isValid =
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    coordinates.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    coordinates[0] >= -180 &&
    coordinates[0] <= 180 &&
    coordinates[1] >= -90 &&
    coordinates[1] <= 90;

  if (!isValid) {
    throw new AppError(
      "Coordinates must be [longitude (-180..180), latitude (-90..90)]",
      400,
      "INVALID_COORDINATES",
    );
  }
};

/**
 * Validate business rules of the merged preferences (shared by onboarding and profile update).
 */
const assertValidPreferences = (preferences) => {
  if (!preferences) return;

  const { maxDistanceKm, preferredAgeRange } = preferences;

  if (
    maxDistanceKm !== undefined &&
    (typeof maxDistanceKm !== "number" ||
      maxDistanceKm < PREFERENCE_LIMITS.MIN_DISTANCE_KM ||
      maxDistanceKm > PREFERENCE_LIMITS.MAX_DISTANCE_KM)
  ) {
    throw new AppError(
      `maxDistanceKm must be between ${PREFERENCE_LIMITS.MIN_DISTANCE_KM} and ${PREFERENCE_LIMITS.MAX_DISTANCE_KM}`,
      400,
      "INVALID_PREFERENCES",
    );
  }

  if (preferredAgeRange) {
    const { min, max } = preferredAgeRange;
    const inRange = (value) =>
      typeof value === "number" &&
      value >= PREFERENCE_LIMITS.MIN_CHILD_AGE &&
      value <= PREFERENCE_LIMITS.MAX_CHILD_AGE;

    if (!inRange(min) || !inRange(max) || min > max) {
      throw new AppError(
        `preferredAgeRange must satisfy ${PREFERENCE_LIMITS.MIN_CHILD_AGE} <= min <= max <= ${PREFERENCE_LIMITS.MAX_CHILD_AGE}`,
        400,
        "INVALID_PREFERENCES",
      );
    }
  }
};

class ParentService {
  async getParentByUserId(userId) {
    return parentRepository.findByUserId(userId);
  }

  async getParentById(id) {
    return parentRepository.findById(id);
  }

  /**
   * Parents visible in discovery near a point, nearest first
   * @param {[number, number]} coordinates - [longitude, latitude]
   * @param {number} maxDistanceMeters
   * @param {Array<string|ObjectId>} excludeParentIds - Self and blocked parents
   * @param {number} limit
   */
  async findNearbyVisibleParents(coordinates, maxDistanceMeters, excludeParentIds, limit) {
    return parentRepository.findNearbyVisible(coordinates, maxDistanceMeters, excludeParentIds, limit);
  }
  
  /**
   * Build the next location from a partial client update, geocoding when coordinates are absent.
   * Only address/area/city/coordinates are accepted from the client.
   * @param {Object} existingLocation
   * @param {Object} locationUpdate
   * @param {{ geocodeWhenMissing: boolean }} options - Onboarding always resolves coordinates;
   *   profile updates only geocode when the address actually changes
   */
  async _buildLocation(existingLocation, locationUpdate, { geocodeWhenMissing }) {
    const area = locationUpdate.area !== undefined ? locationUpdate.area : existingLocation.area;
    const city = locationUpdate.city !== undefined ? locationUpdate.city : existingLocation.city;

    // Automatically construct address by joining area and city if not explicitly provided
    const address = locationUpdate.address?.trim()
      ? locationUpdate.address.trim()
      : [area, city].filter(Boolean).join(", ");

    assertValidCoordinates(locationUpdate.coordinates);
    let coordinates = locationUpdate.coordinates;
    const isMissingOrZero = !coordinates || (coordinates[0] === 0 && coordinates[1] === 0);
    const hasNewAddress = Boolean(locationUpdate.address || locationUpdate.area || locationUpdate.city);

    if (isMissingOrZero && (geocodeWhenMissing || hasNewAddress)) {
      coordinates = await geocodingAdapter.getCoordinatesByAddress(area || address, city);
    }

    const nextCoordinates = coordinates || existingLocation.coordinates?.coordinates || [0, 0];

    return {
      address,
      area: area || "",
      city: city || "",
      coordinates: { type: "Point", coordinates: nextCoordinates },
    };
  }

  /**
   * Get the parent profile of a user
   * @param {Object} user - Authenticated user document (provides email/phone for the DTO)
   */
  async getMyProfile(user) {
    const parent = await parentRepository.findByUserId(user._id);
    if (!parent) {
      throw new AppError("Parent profile not found", 404, "PARENT_NOT_FOUND");
    }

    return ParentProfileDTO.toResponse(parent, user);
  }

  async createParentProfile(data) {
    return parentRepository.create(data);
  }

  /**
   * Hard delete a parent profile (used to roll back a failed registration)
   */
  async deleteParentByUserId(userId) {
    return parentRepository.deleteByUserId(userId);
  }

  async updateVerification(userId, verificationUpdates) {
    return parentRepository.updateVerification(userId, verificationUpdates);
  }

  /**
   * @param {Object} user - Authenticated user document
   * @param {{ location?: Object, preferences?: Object }} data
   */
  async updateOnboardingPreferences(user, { location, preferences }) {
    const parent = await parentRepository.findByUserId(user._id);
    if (!parent) {
      throw new AppError("Parent profile not found", 404, "PARENT_NOT_FOUND");
    }

    const updatePayload = {};
    if (location) {
      const existingLocation = parent.location?.toObject?.() || parent.location || {};
      updatePayload.location = await this._buildLocation(existingLocation, location, {
        geocodeWhenMissing: true,
      });
    }

    if (preferences) {
      updatePayload.preferences = {
        ...(parent.preferences?.toObject?.() || parent.preferences),
        ...preferences,
      };
      assertValidPreferences(updatePayload.preferences);
    }

    const updatedParent = await parentRepository.updateByUserId(user._id, updatePayload);
    return ParentProfileDTO.toResponse(updatedParent, user);
  }

  /**
   * @param {Object} user - Authenticated user document
   * @param {Object} updateData
   */
  async updateProfile(user, updateData) {
    const parent = await parentRepository.findByUserId(user._id);
    if (!parent) {
      throw new AppError("Parent profile not found", 404, "PARENT_NOT_FOUND");
    }

    const updatePayload = {};

    if (updateData.fullName !== undefined) {
      updatePayload.fullName = updateData.fullName;
    }

    if (updateData.bio !== undefined) {
      updatePayload.bio = updateData.bio;
    }

    if (updateData.location) {
      const existingLocation = parent.location?.toObject?.() || parent.location || {};
      updatePayload.location = await this._buildLocation(existingLocation, updateData.location, {
        geocodeWhenMissing: false,
      });
    }

    if (updateData.preferences) {
      updatePayload.preferences = {
        ...(parent.preferences?.toObject?.() || parent.preferences),
        ...updateData.preferences,
      };
      assertValidPreferences(updatePayload.preferences);
    }

    if (updateData.privacySettings) {
      updatePayload.privacySettings = {
        ...(parent.privacySettings?.toObject?.() || parent.privacySettings),
        ...updateData.privacySettings,
      };
    }

    const updatedParent = await parentRepository.updateByUserId(user._id, updatePayload);
    return ParentProfileDTO.toResponse(updatedParent, user);
  }

  async updateAvatar(userId, fileBuffer, mimetype) {
    const parent = await parentRepository.findByUserId(userId);
    if (!parent) {
      throw new AppError("Parent profile not found", 404, "PARENT_NOT_FOUND");
    }

    if (!fileBuffer) {
      throw new AppError(
        "Avatar image file is required",
        400,
        "AVATAR_FILE_REQUIRED",
      );
    }

    const previousAvatarUrl = parent.avatarUrl;

    const uploadResult = await storageAdapter.uploadImage(fileBuffer, {
      folder: "buddylink/parents/avatars",
      transformation: [
        { width: 400, height: 400, crop: "fill", gravity: "face" },
        { quality: "auto", fetch_format: "auto" },
      ],
      mimetype,
    });

    const updatedParent = await parentRepository.updateByUserId(userId, {
      avatarUrl: uploadResult.url,
    });

    // Remove the replaced image from Cloud Storage (best effort, never blocks the update)
    const previousPublicId = storageAdapter.getPublicIdFromUrl(previousAvatarUrl);
    if (previousPublicId && previousPublicId !== uploadResult.publicId) {
      await storageAdapter.deleteImage(previousPublicId);
    }

    return {
      avatarUrl: updatedParent.avatarUrl,
    };
  }
}

export default new ParentService();
