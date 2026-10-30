import childRepository from './child.repository.js';
import parentService from '../parent/parent.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import safetyService from '../safety/safety.service.js';
import userService from '../user/user.service.js';
import AppError from '../../shared/exceptions/app-error.js';
import { startTransactionIfSupported } from '../../shared/helpers/transaction.helper.js';
import { ChildResponseDTO, ChildPublicProfileDTO } from './child.dto.js';
import { CHILD_AGE_GROUPS, CHILD_EDITABLE_FIELDS } from './child.constants.js';
// Repository, not ConnectionService: that service imports this one
import connectionRepository from '../connection/connection.repository.js';
import { CONNECTION_STATUS, VIEWER_CONNECTION_STATUS } from '../connection/connection.constants.js';

/**
 * Keep only client-editable fields so a request body cannot set parentId, isArchived, _id...
 */
const pickEditableFields = (data = {}) =>
  CHILD_EDITABLE_FIELDS.reduce((picked, field) => {
    if (data[field] !== undefined) {
      picked[field] = data[field];
    }
    return picked;
  }, {});

class ChildService {
  /**
   * Helper to retrieve parent._id from authenticated req.userId
   */
  async _getParentId(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }
    return parent._id;
  }

  /**
   * Create a new child profile
   */
  async createChild(userId, childData) {
    const parentId = await this._getParentId(userId);

    const session = await startTransactionIfSupported();

    try {
      // Enforce subscription quota on child profiles count
      const currentCount = await childRepository.countByParentId(parentId, session);
      await subscriptionService.checkChildProfileQuota(parentId, currentCount, session);

      const child = await childRepository.create(
        {
          ...pickEditableFields(childData),
          parentId,
        },
        session
      );

      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      return ChildResponseDTO.toResponse(child);
    } catch (err) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch {
          // Already aborted: nothing left to roll back
        }
        session.endSession();
      }
      throw err;
    }
  }

  /**
   * Get all children belonging to authenticated parent
   */
  async getMyChildren(userId) {
    const parentId = await this._getParentId(userId);
    const [children, lockedIds] = await Promise.all([
      childRepository.findByParentId(parentId),
      this.getLockedChildIds([parentId]),
    ]);
    return ChildResponseDTO.toResponseList(children, lockedIds);
  }

  /**
   * Get one of the authenticated parent's child profiles by ID.
   * Other parents' children are reported as not found to avoid leaking their existence.
   */
  async getChildById(userId, id) {
    const parentId = await this._getParentId(userId);
    const child = await childRepository.findByIdAndParentId(id, parentId);
    if (!child) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }
    return ChildResponseDTO.toResponse(child, await this.getLockedChildIds([parentId]));
  }

  /**
   * Update child profile
   */
  async updateChild(userId, id, updateData) {
    const parentId = await this._getParentId(userId);

    const updatedChild = await childRepository.updateById(id, parentId, pickEditableFields(updateData));
    if (!updatedChild) {
      throw new AppError('Child not found or you are not authorized to update this profile', 404, 'CHILD_NOT_FOUND');
    }

    return ChildResponseDTO.toResponse(updatedChild, await this.getLockedChildIds([parentId]));
  }

  /**
   * Soft delete child profile
   */
  async deleteChild(userId, id) {
    const parentId = await this._getParentId(userId);

    const deletedChild = await childRepository.softDeleteById(id, parentId);
    if (!deletedChild) {
      throw new AppError('Child not found or you are not authorized to delete this profile', 404, 'CHILD_NOT_FOUND');
    }

    return { message: 'Child profile deleted successfully' };
  }

  /**
   * Count active children belonging to a parent
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async countChildrenByParentId(parentId) {
    return childRepository.countByParentId(parentId);
  }

  /**
   * Get an active (non-archived) child profile by ID, regardless of owner.
   * Used by other modules (e.g. discovery) that act on another parent's child.
   * @param {string|mongoose.Types.ObjectId} childId
   */
  async getActiveChildById(childId) {
    return childRepository.findActiveById(childId);
  }

  /**
   * Active children of nearby parents for discovery (excludes swiped, applies age/interest filters)
   * @param {Object} criteria - { parentIds, excludeChildIds, ageMin, ageMax, interests }
   */
  async getDiscoverableChildren(criteria) {
    if (!criteria.parentIds || criteria.parentIds.length === 0) return [];
    return this._withoutLocked(await childRepository.findDiscoverable(criteria));
  }

  /**
   * IDs of the children locked by the Free plan: a parent whose Premium ended keeps the oldest
   * childProfilesLimit children usable, the newer ones stay visible and editable to the parent
   * but cannot be used for discovery or playdates (unlocked again on renewal)
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Set<string>>}
   */
  async getLockedChildIds(parentIds) {
    const locked = new Set();
    const limits = await subscriptionService.getChildProfileLimits(parentIds);
    const limitedParentIds = [...limits].filter(([, limit]) => limit !== -1).map(([id]) => id);
    if (!limitedParentIds.length) return locked;

    const children = await childRepository.findIdsByParentIdsOldestFirst(limitedParentIds);
    const keptByParent = new Map();
    for (const child of children) {
      const parentKey = child.parentId.toString();
      const kept = keptByParent.get(parentKey) || 0;
      if (kept < limits.get(parentKey)) {
        keptByParent.set(parentKey, kept + 1);
      } else {
        locked.add(child._id.toString());
      }
    }
    return locked;
  }

  /**
   * Whether a child is locked by its parent's Free plan
   * @param {string|ObjectId} childId
   * @param {string|ObjectId} parentId - The child's parent
   */
  async isChildLocked(childId, parentId) {
    return (await this.getLockedChildIds([parentId])).has(childId.toString());
  }

  /**
   * Reject an own child locked by the Free plan (a child of someone else is never reported locked)
   * @param {string|ObjectId} childId
   * @param {string|ObjectId} parentId - The caller's parent ID
   * @param {Set<string>} [lockedIds] - Result of getLockedChildIds already loaded for this parent
   */
  async assertChildUsable(childId, parentId, lockedIds = null) {
    if (!childId) return;
    const locked = lockedIds || (await this.getLockedChildIds([parentId]));
    if (locked.has(childId.toString())) {
      throw new AppError(
        'This child profile is locked on the Free plan. Upgrade to Premium to use it again.',
        403,
        'CHILD_PROFILE_LOCKED'
      );
    }
  }

  /**
   * Leave out the children locked by the Free plan
   * @private
   */
  async _withoutLocked(children) {
    if (!children.length) return children;
    const lockedIds = await this.getLockedChildIds(children.map((c) => c.parentId));
    return children.filter((c) => !lockedIds.has(c._id.toString()));
  }

  /**
   * Active children of a parent that are not locked by the Free plan (discovery, playdates)
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getUsableChildrenByParentId(parentId) {
    return this._withoutLocked(await childRepository.findByParentId(parentId));
  }

  /**
   * Usable children grouped by parent, in one query (see getActiveChildrenByParentIds)
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Map<string, Array<Object>>>} parentId -> children (newest first)
   */
  async getUsableChildrenByParentIds(parentIds) {
    const children = await this._withoutLocked(await childRepository.findByParentIds(parentIds));
    const byParent = new Map();
    for (const child of children) {
      const key = child.parentId.toString();
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(child);
    }
    return byParent;
  }

  /**
   * Usable children by ID (archived and locked ones are left out), in one query
   * @param {Array<string|ObjectId>} childIds
   * @returns {Promise<Array<Object>>}
   */
  async getUsableChildrenByIds(childIds) {
    return this._withoutLocked(await this.getActiveChildrenByIds(childIds));
  }

  /**
   * Get all active children belonging to a parent
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getActiveChildrenByParentId(parentId) {
    return childRepository.findByParentId(parentId);
  }

  /**
   * Active children grouped by parent, in one query (lists showing many families)
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Map<string, Array<Object>>>} parentId -> children (newest first)
   */
  async getActiveChildrenByParentIds(parentIds) {
    const children = await childRepository.findByParentIds(parentIds);
    const byParent = new Map();
    for (const child of children) {
      const key = child.parentId.toString();
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(child);
    }
    return byParent;
  }

  /**
   * Active children by ID (archived ones are left out), in one query
   * @param {Array<string|ObjectId>} childIds
   * @returns {Promise<Array<Object>>}
   */
  async getActiveChildrenByIds(childIds) {
    const uniqueIds = [...new Set((childIds || []).filter(Boolean).map(String))];
    return childRepository.findActiveByIds(uniqueIds);
  }

  /**
   * IDs of the parents having a child whose name contains the text
   * @param {string} search
   * @returns {Promise<Array<ObjectId>>}
   */
  async findParentIdsByChildName(search) {
    return childRepository.findParentIdsByChildName(search);
  }

  /**
   * Get all active children of a parent, shaped for API responses (playdate invite list)
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getChildrenByParentId(parentId) {
    const children = await childRepository.findByParentId(parentId);
    return ChildResponseDTO.toResponseList(children);
  }

  /**
   * Check if an active child belongs to a specific parent
   * @param {string|mongoose.Types.ObjectId} childId
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async isChildOwnedByParent(childId, parentId) {
    const child = await childRepository.findActiveById(childId);
    if (!child) return false;
    return child.parentId?.toString() === parentId.toString();
  }

  /**
   * Get public profile of a child as seen by the authenticated parent.
   * Children of hidden parents, or of parents in a block relationship with the viewer,
   * are reported as not found so their existence is not leaked.
   * @param {string} userId - Authenticated viewer's user ID
   * @param {string} childId
   */
  async getPublicProfile(userId, childId) {
    const viewerParentId = await this._getParentId(userId);
    const child = await childRepository.findByIdWithParent(childId);
    if (!child) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    const parent = child.parentId || {};
    const isOwnChild = parent._id?.toString() === viewerParentId.toString();

    if (!isOwnChild) {
      const isHidden = parent.privacySettings?.isProfileHidden === true;
      const isBlocked = isHidden ? false : await safetyService.isBlocked(viewerParentId, parent._id);
      const isParentActive = parent.userId
        ? (await userService.getActiveUserIds([parent.userId])).length > 0
        : true;
      if (isHidden || isBlocked || !isParentActive) {
        throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
      }
    }

    const connectionStatus = isOwnChild
      ? VIEWER_CONNECTION_STATUS.NONE
      : await this._getViewerConnectionStatus(viewerParentId, parent._id);
    return ChildPublicProfileDTO.toResponse(child, connectionStatus);
  }

  /**
   * Pending / accepted connection between the viewer and another parent, from the viewer's side
   * @returns {Promise<string>} VIEWER_CONNECTION_STATUS
   */
  async _getViewerConnectionStatus(viewerParentId, otherParentId) {
    const connection = await connectionRepository.findActiveBetween(viewerParentId, otherParentId);
    if (!connection) return VIEWER_CONNECTION_STATUS.NONE;
    if (connection.status === CONNECTION_STATUS.ACCEPTED) return VIEWER_CONNECTION_STATUS.CONNECTED;
    return connection.requesterId.toString() === viewerParentId.toString()
      ? VIEWER_CONNECTION_STATUS.SENT
      : VIEWER_CONNECTION_STATUS.RECEIVED;
  }

  /**
   * Get all children belonging to a parent including archived (for admin)
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getAllChildrenByParentId(parentId) {
    return childRepository.findAllByParentId(parentId);
  }

  /**
   * Get child by ID regardless of status (for admin)
   * @param {string|mongoose.Types.ObjectId} childId
   */
  async getChildByIdRaw(childId) {
    return childRepository.findById(childId);
  }


  /**
   * Page of child profiles for admin lists. Ages are whole years: a child is `age` years old
   * from its birthday until the day before the next one.
   * @param {Object} criteria
   * @param {string} [criteria.search]
   * @param {Array<string|ObjectId>} [criteria.searchParentIds] - Parents whose name matches the search
   * @param {string} [criteria.gender]
   * @param {boolean} [criteria.isArchived]
   * @param {number} [criteria.minAge]
   * @param {number} [criteria.maxAge]
   * @param {number} criteria.page
   * @param {number} criteria.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async getChildrenPage({ minAge, maxAge, ...criteria }) {
    const now = new Date();
    const yearsAgo = (years) => new Date(now.getFullYear() - years, now.getMonth(), now.getDate());

    return childRepository.findPage({
      ...criteria,
      // At most maxAge: born less than (maxAge + 1) years ago
      bornAfter: Number.isInteger(maxAge) ? yearsAgo(maxAge + 1) : undefined,
      // At least minAge: born minAge years ago or earlier
      bornOnOrBefore: Number.isInteger(minAge) ? yearsAgo(minAge) : undefined,
    });
  }

  /**
   * Number of active (non-archived) children per parent
   * @param {Array<string|ObjectId>} parentIds
   * @returns {Promise<Map<string, number>>} parentId -> count
   */
  async countActiveChildrenByParentIds(parentIds) {
    const rows = await childRepository.countActiveGroupedByParentIds(parentIds);
    return new Map(rows.map((row) => [row._id.toString(), row.count]));
  }

  /**
   * Child profiles across the platform, for admin statistics
   * @returns {Promise<{ total: number, active: number, archived: number, planLocked: number }>}
   */
  async getChildStats() {
    const [counts, planLockedIds] = await Promise.all([
      childRepository.countByArchiveStatus(),
      this.getAllPlanLockedChildIds(),
    ]);
    return { ...counts, planLocked: planLockedIds.size };
  }

  /**
   * Every child locked by its parent's plan across the platform (see getLockedChildIds): only parents with
   * more children than the lowest plan limit can have some
   * @returns {Promise<Set<string>>}
   */
  async getAllPlanLockedChildIds() {
    const lowestLimit = await subscriptionService.getLowestChildProfileLimit();
    if (lowestLimit === -1) return new Set();

    const overLimitParents = await childRepository.findParentsWithActiveChildrenAbove(lowestLimit);
    if (!overLimitParents.length) return new Set();
    return this.getLockedChildIds(overLimitParents.map((row) => row._id));
  }

  /**
   * Total active children on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countActiveBeforeDate(date) {
    return childRepository.countActiveBeforeDate(date);
  }

  /**
   * Count distinct parents who created at least one active child profile on or before a date
   * @param {Date} [date]
   * @returns {Promise<number>}
   */
  async countDistinctParentsWithActiveChildrenBeforeDate(date) {
    return childRepository.countDistinctParentsWithActiveChildrenBeforeDate(date);
  }

  /**
   * Distribution of children by standard age groups
   * @returns {Promise<Array<{ group: string, count: number }>>}
   */
  async getChildAgeGroupStats() {
    const now = new Date();
    const groups = CHILD_AGE_GROUPS.map(({ label, bornAfterYears }) => ({
      key: label,
      bornAfter: bornAfterYears
        ? new Date(now.getFullYear() - bornAfterYears, now.getMonth(), now.getDate())
        : null,
    }));
    const rows = await childRepository.countByBirthDateGroups(groups);
    const countByKey = new Map(rows.map((row) => [row.key, row.count]));
    return CHILD_AGE_GROUPS.map(({ label }) => ({ group: label, count: countByKey.get(label) || 0 }));
  }
}

export default new ChildService();
