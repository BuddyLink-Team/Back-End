import childRepository from './child.repository.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { ChildResponseDTO } from './child.dto.js';

class ChildService {
  /**
   * Helper to retrieve parent._id from authenticated req.userId
   */
  async _getParentId(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Hồ sơ phụ huynh không tồn tại', 404, 'PARENT_NOT_FOUND');
    }
    return parent._id;
  }

  /**
   * Create a new child profile
   */
  async createChild(userId, childData) {
    const parentId = await this._getParentId(userId);

    const child = await childRepository.create({
      ...childData,
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
   * Get child profile by ID
   */
  async getChildById(id) {
    const child = await childRepository.findById(id);
    if (!child) {
      throw new AppError('Hồ sơ trẻ không tồn tại', 404, 'CHILD_NOT_FOUND');
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
      throw new AppError('Không tìm thấy bé hoặc bạn không có quyền chỉnh sửa', 404, 'CHILD_NOT_FOUND');
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
      throw new AppError('Không tìm thấy bé hoặc bạn không có quyền xóa', 404, 'CHILD_NOT_FOUND');
    }

    return { message: 'Xóa hồ sơ bé thành công' };
  }
}

export default new ChildService();
