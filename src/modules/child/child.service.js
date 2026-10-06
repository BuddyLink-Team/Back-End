import childRepository from './child.repository.js';
import parentService from '../parent/parent.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { ChildResponseDTO } from './child.dto.js';
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

    // Enforce subscription quota on child profiles count
    await subscriptionService.checkChildProfileQuota(parentId);

    const child = await childRepository.create({
      ...pickEditableFields(childData),
      parentId,
    });

    return ChildResponseDTO.toResponse(child);
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
   * Get public profile of a child, masking data per privacySettings
   * @param {string} childId
   */
  async getPublicProfile(childId) {
    const child = await childRepository.findByIdWithParent(childId);
    if (!child) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    const priv = child.privacySettings || {};
    const parent = child.parentId || {};

    // Calculate age in years
    const ageYears = child.dateOfBirth
      ? Math.floor((Date.now() - new Date(child.dateOfBirth)) / (365.25 * 24 * 3600 * 1000))
      : null;

    return {
      childId: child._id,
      displayName: priv.showFullName !== false ? child.displayName : child.displayName?.split(' ').pop(),
      age:         priv.showAge     !== false ? ageYears : null,
      gender:      priv.showGender  !== false ? child.gender : null,
      avatarUrl:   priv.showRealPhoto === true ? child.avatarUrl : null,
      schoolLevel: priv.showSchool  === true  ? child.schoolLevel : null,
      interests:   priv.showInterests   !== false ? (child.interests || [])         : [],
      favoriteActivities: priv.showInterests !== false ? (child.favoriteActivities || []) : [],
      personality: priv.showPersonality !== false ? (child.personality || [])       : [],
      parent: {
        fullName:        parent.fullName,
        avatarUrl:       parent.avatarUrl || null,
        bio:             parent.bio       || null,
        area:            parent.area      || parent.city || null,
        isVerifiedParent: parent.isVerifiedParent || false,
        verifiedPhone:   parent.verifiedPhone || false,
        verifiedEmail:   parent.verifiedEmail || false,
      },
    };
  }
}

export default new ChildService();
