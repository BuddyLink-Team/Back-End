import childRepository from './child.repository.js';
import parentService from '../parent/parent.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import safetyService from '../safety/safety.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { startTransactionIfSupported } from '../../shared/helpers/transaction.helper.js';
import { ChildResponseDTO, ChildPublicProfileDTO } from './child.dto.js';
import { CHILD_EDITABLE_FIELDS } from './child.constants.js';

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
    const children = await childRepository.findByParentId(parentId);
    return ChildResponseDTO.toResponseList(children);
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
    return ChildResponseDTO.toResponse(child);
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

    return ChildResponseDTO.toResponse(updatedChild);
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
    return childRepository.findDiscoverable(criteria);
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
      if (isHidden || isBlocked) {
        throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
      }
    }

    return ChildPublicProfileDTO.toResponse(child);
  }
}

export default new ChildService();
