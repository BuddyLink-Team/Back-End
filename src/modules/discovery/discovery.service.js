import discoveryRepository from './discovery.repository.js';
import parentService from '../parent/parent.service.js';
import userService from '../user/user.service.js';
import childService from '../child/child.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import safetyService from '../safety/safety.service.js';
import connectionService from '../connection/connection.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { DiscoveryProfileDTO } from './discovery.dto.js';
import { DISCOVERY_DEFAULTS } from './discovery.constants.js';
import { calculateMatchScore, calculateChildPairScore } from './matching.rules.js';
import { SUBSCRIPTION_PLAN_CODES } from '../subscription/subscription.constants.js';

class DiscoveryService {
  constructor() {
    // Nearest discoverable children scored per request (instance field so tests can lower it)
    this.candidatePoolSize = DISCOVERY_DEFAULTS.CANDIDATE_POOL_SIZE;
  }

  /**
   * Get discovery profiles for the authenticated parent.
   * Performs geo-filtering, exclusion logic, Smart Matching scoring, and quota awareness.
   *
   * @param {string} userId - Authenticated user's ID (from JWT)
   * @param {Object} queryFilters - { lat, lng, maxDistanceKm, ageMin, ageMax, interests, childId }
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

    // Step 3: Parse filters
    const filters = {};
    if (queryFilters.ageMin !== undefined) {
      filters.ageMin = parseInt(queryFilters.ageMin, 10);
    }
    if (queryFilters.ageMax !== undefined) {
      filters.ageMax = parseInt(queryFilters.ageMax, 10);
    }
    if (queryFilters.interests) {
      filters.interests = queryFilters.interests
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    // Step 4: Load quota info (do not consume here), current children and exclusion lists
    const [quotaSummary, currentChildren, blockedParentIds] = await Promise.all([
      subscriptionService.getQuotaSummary(parent._id),
      childService.getActiveChildrenByParentId(parent._id),
      safetyService.getBlockedParentIds(parent._id),
    ]);

    // Match against the selected child only (when the parent has several), otherwise all of them
    const matchingChildren = queryFilters.childId
      ? currentChildren.filter((c) => c._id.toString() === queryFilters.childId)
      : currentChildren;
    if (queryFilters.childId && matchingChildren.length === 0) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    // Swipes are per own child: hide the cards already swiped for the child we search for.
    // Without a selected child and with several children, hide every swipe of the parent.
    const searchingForChildId =
      queryFilters.childId || (currentChildren.length === 1 ? currentChildren[0]._id.toString() : null);
    const swipedChildIds = await discoveryRepository.getSwipedChildIds(parent._id, searchingForChildId);

    const viewLimit = quotaSummary.limits.discoveryViewsPerDay;
    const remainingViews =
      viewLimit === -1
        ? -1
        : Math.max(0, viewLimit - (quotaSummary.usage.discoveryViewsToday || 0));
    const isPremium = quotaSummary.planCode !== SUBSCRIPTION_PLAN_CODES.FREE;
    const excludeParentIds = [parent._id.toString(), ...blockedParentIds];

    // Step 5: Collect candidates from the owning modules: visible parents inside the radius with
    // an active account, then their children not swiped yet and matching the filters.
    // The candidate pool is cut AFTER removing swiped children, so parents further away still
    // show up once the nearest ones have all been swiped.
    const nearbyParents = await parentService.findNearbyVisibleParents(
      [lng, lat],
      maxDistanceMeters,
      excludeParentIds,
      DISCOVERY_DEFAULTS.MAX_NEARBY_PARENTS
    );
    const activeUserIds = new Set(
      await userService.getActiveUserIds(nearbyParents.map((p) => p.userId))
    );
    const candidateParents = nearbyParents.filter((p) => activeUserIds.has(p.userId.toString()));
    const parentsById = new Map(candidateParents.map((p) => [p._id.toString(), p]));

    const candidateChildren = await childService.getDiscoverableChildren({
      parentIds: [...parentsById.keys()],
      excludeChildIds: swipedChildIds,
      ...filters,
    });

    const rawProfiles = candidateChildren
      .map((child) => {
        const childParent = parentsById.get(child.parentId.toString());
        return { child, parent: childParent, distanceKm: childParent.distanceKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, this.candidatePoolSize);

    // Calculate the matched children's interests set once
    const currentSet = new Set();
    matchingChildren.forEach((child) => {
      (child.interests || []).forEach((i) => currentSet.add(i.toLowerCase()));
      (child.favoriteActivities || []).forEach((a) => currentSet.add(a.toLowerCase()));
    });

    // Step 6: Calculate match scores and sort
    const scoredProfiles = rawProfiles.map((profile) => {
      const matchScore = calculateMatchScore(
        parent,
        matchingChildren,
        profile.child,
        profile.parent,
        profile.distanceKm,
        maxDistanceKm
      );

      const targetSet = new Set();
      (profile.child.interests || []).forEach((i) => targetSet.add(i.toLowerCase()));
      (profile.child.favoriteActivities || []).forEach((a) => targetSet.add(a.toLowerCase()));

      let matchedInterestsCount = 0;
      targetSet.forEach((item) => {
        if (currentSet.has(item)) matchedInterestsCount++;
      });

      return {
        child: profile.child,
        parent: profile.parent,
        matchScore,
        distanceKm: profile.distanceKm,
        matchedInterestsCount,
      };
    });

    // Sort by matchScore descending, then keep the best matches only
    scoredProfiles.sort((a, b) => b.matchScore - a.matchScore);
    const topProfiles = scoredProfiles.slice(0, DISCOVERY_DEFAULTS.MAX_RESULTS_PER_REQUEST);

    // Step 7: Shape response via DTO
    const profiles = DiscoveryProfileDTO.toResponseList(topProfiles);

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
   * Resolve which of the parent's own children a swipe is for:
   * the given one (must be theirs), or their only child when they have exactly one.
   * @param {Array<Object>} ownChildren - Active children of the swiping parent
   * @param {string} [forChildId]
   * @returns {Object} The child document
   * @private
   */
  _resolveSwipeChild(ownChildren, forChildId) {
    if (forChildId) {
      const child = ownChildren.find((c) => c._id.toString() === forChildId.toString());
      if (!child) {
        throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
      }
      return child;
    }
    if (ownChildren.length === 1) return ownChildren[0];
    throw new AppError(
      ownChildren.length === 0
        ? 'Add a child profile before finding friends'
        : 'Choose which of your children this swipe is for',
      400,
      'CHILD_REQUIRED_FOR_SWIPE'
    );
  }

  /**
   * Record a swipe action (Like or Pass) for one of the parent's children and consume a discovery
   * quota unit. A Like also sends a connection request to the target child's parent and records the
   * child pair (forChild <-> targetChild) on that connection.
   *
   * @param {string} userId - Authenticated user's ID (from JWT)
   * @param {string} targetChildId - The child profile being swiped
   * @param {boolean} isLike - true for Like, false for Pass
   * @param {string} [forChildId] - Own child the swipe is for (optional when the parent has one child)
   * @returns {Promise<Object>}
   */
  async swipeProfile(userId, targetChildId, isLike, forChildId) {
    // Step 1: Get parent profile
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    // Step 2: Validate target child exists and belongs to a different parent
    const targetChild = await childService.getActiveChildById(targetChildId);
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

    // Step 3: Resolve the own child the swipe is for
    const ownChildren = await childService.getActiveChildrenByParentId(parent._id);
    const forChild = this._resolveSwipeChild(ownChildren, forChildId);

    // Step 4: Check if already swiped for this child (legacy swipes without a child count for every child)
    const existingSwipe = await discoveryRepository.findExistingSwipe(
      parent._id,
      targetChildId,
      forChild._id
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

    // Step 6: A Like sends a connection request — make sure it can be sent before spending quota
    if (isLike) {
      await connectionService.validateConnectionRequest(parent._id, targetChild.parentId);
    }

    // Step 7: Consume discovery quota only once the swipe is known to be valid
    const quotaResult = await subscriptionService.checkAndConsumeQuota(
      parent._id,
      'discovery',
      true
    );

    // Step 8: Create swipe record (a concurrent duplicate hits the unique index)
    let swipe;
    try {
      swipe = await discoveryRepository.createSwipe(
        parent._id,
        targetChildId,
        targetChild.parentId,
        isLike,
        forChild._id
      );
    } catch (error) {
      if (error.code === 11000) {
        throw new AppError('You have already swiped on this profile', 409, 'DUPLICATE_SWIPE');
      }
      throw error;
    }

    // Step 9: Like = send connection request (consumes the monthly connection request quota)
    // and remember which children were matched
    let connection = null;
    if (isLike) {
      const targetParent = await parentService.getParentById(targetChild.parentId);
      const result = await connectionService.sendConnectionRequest(parent._id, targetChild.parentId, {
        forChildId: forChild._id,
        targetChildId: targetChild._id,
        matchScore: calculateChildPairScore(forChild, parent, targetChild, targetParent),
      });
      connection = {
        connectionId: result.connection._id,
        status: result.connection.status,
        isNew: result.isNew,
        isMatched: result.isMatched,
      };
    }

    return {
      swipeId: swipe._id,
      isLike: swipe.isLike,
      forChildId: forChild._id,
      remainingViews: quotaResult.remaining,
      connection,
    };
  }
}

export default new DiscoveryService();
