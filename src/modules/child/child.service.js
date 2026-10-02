import mongoose from 'mongoose';
import childRepository from './child.repository.js';
import parentService from '../parent/parent.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { ChildResponseDTO } from './child.dto.js';

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

    let session = null;
    try {
      const topologyType = mongoose.connection?.client?.topology?.description?.type;
      const isReplicaSet =
        topologyType === 'ReplicaSetWithPrimary' ||
        topologyType === 'ReplicaSetNoPrimary' ||
        topologyType === 'Sharded';
      if (isReplicaSet) {
        session = await mongoose.startSession();
        session.startTransaction();
      }
    } catch (e) {
      session = null;
    }

    try {
      // Enforce subscription quota on child profiles count
      const currentCount = await childRepository.countByParentId(parentId, session);
      await subscriptionService.checkChildProfileQuota(parentId, currentCount, session);

      const child = await childRepository.create(
        {
          ...childData,
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
        } catch (e) {}
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
   * Get child profile by ID
   */
  async getChildById(id) {
    const child = await childRepository.findById(id);
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

    const updatedChild = await childRepository.updateById(id, parentId, updateData);
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
}

export default new ChildService();
