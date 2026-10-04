import Child from './child.model.js';

class ChildRepository {
  async create(childData) {
    return Child.create(childData);
  }

  async findById(id) {
    return Child.findOne({ _id: id, isArchived: false });
  }

  async findByParentId(parentId) {
    return Child.find({ parentId, isArchived: false }).sort({ createdAt: -1 });
  }

  async updateById(id, parentId, updateData) {
    return Child.findOneAndUpdate(
      { _id: id, parentId, isArchived: false },
      { $set: updateData },
      { new: true }
    );
  }

  async softDeleteById(id, parentId) {
    return Child.findOneAndUpdate(
      { _id: id, parentId, isArchived: false },
      { $set: { isArchived: true } },
      { new: true }
    );
  }

  async countByParentId(parentId) {
    return Child.countDocuments({ parentId, isArchived: false });
  }

  /**
   * Find a child by ID and populate parent info for public profile view
   */
  async findByIdWithParent(childId) {
    return Child.findOne({ _id: childId, isArchived: false })
      .populate({
        path: 'parentId',
        select: 'fullName avatarUrl bio area city isVerifiedParent verifiedPhone verifiedEmail',
      })
      .lean();
  }
}

export default new ChildRepository();
