import discoveryRepository from './discovery.repository.js';
import parentService from '../parent/parent.service.js';
import childRepository from '../child/child.repository.js';
import subscriptionService from '../subscription/subscription.service.js';
import safetyService from '../safety/safety.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { DiscoveryProfileDTO } from './discovery.dto.js';
import { MATCHING_WEIGHTS, DISCOVERY_DEFAULTS } from './discovery.constants.js';

class DiscoveryService {
  /**
   * Get discovery profiles for the authenticated parent.
   * Performs geo-filtering, exclusion logic, Smart Matching scoring, and quota awareness.
   *
   * @param {string} userId - Authenticated user's ID (from JWT)
   * @param {Object} queryFilters - { lat, lng, maxDistanceKm, ageMin, ageMax, interests }
   * @returns {Promise<{profiles: Array, meta: Object}>}
   */
  async getDiscoveryProfiles(userId, queryFilters) {
    // Step 1: Get parent profile
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    // Step 2: Determine coordinates (from query or parent profile)
    const lat = queryFilters.lat
      ? parseFloat(queryFilters.lat)
      : parent.location?.coordinates?.coordinates?.[1];
    const lng = queryFilters.lng
      ? parseFloat(queryFilters.lng)
      : parent.location?.coordinates?.coordinates?.[0];

    if (!lat || !lng || (lat === 0 && lng === 0)) {
      throw new AppError(
        'Location is required. Please update your profile location or provide lat/lng query parameters.',
        400,
        'LOCATION_REQUIRED'
      );
    }

    const maxDistanceKm = queryFilters.maxDistanceKm
      ? parseInt(queryFilters.maxDistanceKm, 10)
      : parent.preferences?.maxDistanceKm || DISCOVERY_DEFAULTS.DEFAULT_MAX_DISTANCE_KM;
    const maxDistanceMeters = maxDistanceKm * 1000;

    // Step 3: Get quota info (do not consume here, just check remaining)
    const planFeatures = await subscriptionService.getParentPlanFeatures(parent._id);
    const quotaSummary = await subscriptionService.getQuotaSummary(parent._id);
    const remainingViews =
      planFeatures.discoveryViewLimitPerDay === -1
        ? -1
        : Math.max(
            0,
            planFeatures.discoveryViewLimitPerDay -
              (quotaSummary.usage.discoveryViewsToday || 0)
          );
    const isPremium = planFeatures.planCode !== 'free';

    // Step 4: Get current parent's children (for interest matching)
    const currentChildren = await childRepository.findByParentId(parent._id);

    // Step 5: Build exclusion lists
    const blockedParentIds = await safetyService.getBlockedParentIds(parent._id);
    const swipedChildIds = await discoveryRepository.getSwipedChildIds(parent._id);
    const excludeParentIds = [parent._id.toString(), ...blockedParentIds];

    // Step 6: Parse filters
    const filters = {};
    if (queryFilters.ageMin !== undefined) {
      filters.ageMin = parseInt(queryFilters.ageMin, 10);
    }
    if (queryFilters.ageMax !== undefined) {
      filters.ageMax = parseInt(queryFilters.ageMax, 10);
    }
    if (queryFilters.interests) {
      filters.interests = queryFilters.interests.split(',').map((s) => s.trim());
    }

    // Step 7: Query nearby profiles via repository
    const rawProfiles = await discoveryRepository.findNearbyProfiles(
      [lng, lat],
      maxDistanceMeters,
      excludeParentIds,
      swipedChildIds,
      filters,
      DISCOVERY_DEFAULTS.MAX_RESULTS_PER_REQUEST
    );

    // Step 8: Calculate match scores and sort
    const scoredProfiles = rawProfiles.map((profile) => {
      const matchScore = this._calculateMatchScore(
        parent,
        currentChildren,
        profile.child,
        profile.parent,
        profile.distanceKm
      );
      return {
        child: profile.child,
        parent: profile.parent,
        matchScore,
        distanceKm: profile.distanceKm,
      };
    });

    // Sort by matchScore descending
    scoredProfiles.sort((a, b) => b.matchScore - a.matchScore);

    // Step 9: Shape response via DTO
    const profiles = DiscoveryProfileDTO.toResponseList(scoredProfiles);

    return {
      profiles,
      meta: {
        total: profiles.length,
        returned: profiles.length,
        remainingViews,
        isPremium,
      },
    };
  }

  /**
   * Record a swipe action (Like or Pass) and consume a discovery quota unit.
   *
   * @param {string} userId - Authenticated user's ID (from JWT)
   * @param {string} targetChildId - The child profile being swiped
   * @param {boolean} isLike - true for Like, false for Pass
   * @returns {Promise<Object>}
   */
  async swipeProfile(userId, targetChildId, isLike) {
    // Step 1: Get parent profile
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    // Step 2: Check and consume discovery quota
    const quotaResult = await subscriptionService.checkAndConsumeQuota(
      parent._id,
      'discovery',
      true
    );

    // Step 3: Validate target child exists and belongs to a different parent
    const targetChild = await childRepository.findById(targetChildId);
    if (!targetChild) {
      throw new AppError('Target child profile not found', 404, 'CHILD_NOT_FOUND');
    }
    if (targetChild.parentId.toString() === parent._id.toString()) {
      throw new AppError(
        'You cannot swipe on your own child profile',
        400,
        'SELF_SWIPE_NOT_ALLOWED'
      );
    }

    // Step 4: Check if already swiped
    const existingSwipe = await discoveryRepository.findExistingSwipe(
      parent._id,
      targetChildId
    );
    if (existingSwipe) {
      throw new AppError(
        'You have already swiped on this profile',
        409,
        'DUPLICATE_SWIPE'
      );
    }

    // Step 5: Check if target parent is blocked
    const isBlocked = await safetyService.isBlocked(
      parent._id,
      targetChild.parentId
    );
    if (isBlocked) {
      throw new AppError(
        'Cannot interact with this profile',
        403,
        'BLOCKED_INTERACTION'
      );
    }

    // Step 6: Create swipe record
    const swipe = await discoveryRepository.createSwipe(
      parent._id,
      targetChildId,
      targetChild.parentId,
      isLike
    );

    return {
      swipeId: swipe._id,
      isLike: swipe.isLike,
      remainingViews: quotaResult.remaining,
    };
  }

  // =============================================
  // SMART MATCHING ALGORITHM
  // =============================================

  /**
   * Calculate overall match score between current parent and a target child/parent pair.
   * Score ranges from 0 to 100.
   *
   * @param {Object} currentParent - Authenticated parent document
   * @param {Array} currentChildren - Children belonging to current parent
   * @param {Object} targetChild - Target child document
   * @param {Object} targetParent - Target parent document
   * @param {number} distanceKm - Distance between parents in km
   * @returns {number} Match score (0-100)
   */
  _calculateMatchScore(currentParent, currentChildren, targetChild, targetParent, distanceKm) {
    let score = 0;

    score += this._calcAgeScore(currentParent, targetChild);
    score += this._calcInterestScore(currentChildren, targetChild);
    score += this._calcDistanceScore(distanceKm, currentParent);
    score += this._calcPreferenceScore(currentParent, targetParent);

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * Age Match Score (max 30 points).
   * Full score if target child's age is within parent's preferred age range.
   * Decays linearly as age difference increases.
   */
  _calcAgeScore(currentParent, targetChild) {
    const maxPoints = MATCHING_WEIGHTS.AGE_MATCH;
    const preferredRange = currentParent.preferences?.preferredAgeRange;

    if (!preferredRange || !targetChild.dateOfBirth) {
      return maxPoints * 0.5; // Neutral score when data is missing
    }

    const childAge = DiscoveryProfileDTO.calculateAge(targetChild.dateOfBirth);
    if (childAge === null) return maxPoints * 0.5;

    const { min, max } = preferredRange;

    // Perfect match: within range
    if (childAge >= min && childAge <= max) {
      return maxPoints;
    }

    // Decay: distance from nearest range boundary
    const diff = childAge < min ? min - childAge : childAge - max;
    return Math.max(0, maxPoints - diff * 10);
  }

  /**
   * Interest Overlap Score (max 35 points).
   * Uses Jaccard similarity between all current children's interests/activities
   * and the target child's interests/activities.
   */
  _calcInterestScore(currentChildren, targetChild) {
    const maxPoints = MATCHING_WEIGHTS.INTEREST_OVERLAP;

    if (!currentChildren || currentChildren.length === 0) {
      return maxPoints * 0.3; // Low neutral score
    }

    // Collect all interests and activities from current parent's children
    const currentSet = new Set();
    currentChildren.forEach((child) => {
      (child.interests || []).forEach((i) => currentSet.add(i.toLowerCase()));
      (child.favoriteActivities || []).forEach((a) => currentSet.add(a.toLowerCase()));
    });

    // Collect target child's interests and activities
    const targetSet = new Set();
    (targetChild.interests || []).forEach((i) => targetSet.add(i.toLowerCase()));
    (targetChild.favoriteActivities || []).forEach((a) => targetSet.add(a.toLowerCase()));

    if (currentSet.size === 0 || targetSet.size === 0) {
      return maxPoints * 0.3;
    }

    // Jaccard similarity: |A ∩ B| / |A ∪ B|
    let intersection = 0;
    currentSet.forEach((item) => {
      if (targetSet.has(item)) intersection++;
    });

    const union = new Set([...currentSet, ...targetSet]).size;
    const similarity = union > 0 ? intersection / union : 0;

    return Math.round(similarity * maxPoints);
  }

  /**
   * Distance Proximity Score (max 20 points).
   * Closer parents get higher scores. Linear decay from max distance.
   */
  _calcDistanceScore(distanceKm, currentParent) {
    const maxPoints = MATCHING_WEIGHTS.DISTANCE_PROXIMITY;
    const maxDistanceKm =
      currentParent.preferences?.maxDistanceKm || DISCOVERY_DEFAULTS.DEFAULT_MAX_DISTANCE_KM;

    if (distanceKm <= 0) return maxPoints;
    if (distanceKm >= maxDistanceKm) return 0;

    const proximity = 1 - distanceKm / maxDistanceKm;
    return Math.round(proximity * maxPoints);
  }

  /**
   * Preference Match Score (max 15 points).
   * Compares preferredDays, timeSlots, and preferredLocations between parents.
   * More overlapping preferences → higher score.
   */
  _calcPreferenceScore(currentParent, targetParent) {
    const maxPoints = MATCHING_WEIGHTS.PREFERENCE_MATCH;
    const cp = currentParent.preferences || {};
    const tp = targetParent.preferences || {};

    let totalCategories = 0;
    let matchRatio = 0;

    // Compare preferredPlaydateDays
    if (cp.preferredPlaydateDays?.length && tp.preferredPlaydateDays?.length) {
      totalCategories++;
      const overlap = cp.preferredPlaydateDays.filter((d) =>
        tp.preferredPlaydateDays.includes(d)
      ).length;
      const union = new Set([...cp.preferredPlaydateDays, ...tp.preferredPlaydateDays]).size;
      matchRatio += union > 0 ? overlap / union : 0;
    }

    // Compare preferredTimeSlots
    if (cp.preferredTimeSlots?.length && tp.preferredTimeSlots?.length) {
      totalCategories++;
      const overlap = cp.preferredTimeSlots.filter((t) =>
        tp.preferredTimeSlots.includes(t)
      ).length;
      const union = new Set([...cp.preferredTimeSlots, ...tp.preferredTimeSlots]).size;
      matchRatio += union > 0 ? overlap / union : 0;
    }

    // Compare preferredLocations
    if (cp.preferredLocations?.length && tp.preferredLocations?.length) {
      totalCategories++;
      const overlap = cp.preferredLocations.filter((l) =>
        tp.preferredLocations.includes(l)
      ).length;
      const union = new Set([...cp.preferredLocations, ...tp.preferredLocations]).size;
      matchRatio += union > 0 ? overlap / union : 0;
    }

    if (totalCategories === 0) {
      return Math.round(maxPoints * 0.5); // Neutral when no preference data
    }

    const averageMatch = matchRatio / totalCategories;
    return Math.round(averageMatch * maxPoints);
  }
}

export default new DiscoveryService();
