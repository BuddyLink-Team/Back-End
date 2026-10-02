import Child from './child.model.js';

class ChildRepository {
  async create(childData, session = null) {
    if (session) {
      const created = await Child.create([childData], { session });
      return created[0];
    }
    return Child.create(childData);
  }

  async findById(id, session = null) {
    const query = Child.findOne({ _id: id, isArchived: false });
    if (session) query.session(session);
    return query;
  }

  async findByParentId(parentId, session = null) {
    const query = Child.find({ parentId, isArchived: false }).sort({ createdAt: -1 });
    if (session) query.session(session);
    return query;
  }

  async updateById(id, parentId, updateData, session = null) {
    const options = { new: true };
    if (session) options.session = session;
    return Child.findOneAndUpdate(
      { _id: id, parentId, isArchived: false },
      { $set: updateData },
      options
    );
  }

  async softDeleteById(id, parentId, session = null) {
    const options = { new: true };
    if (session) options.session = session;
    return Child.findOneAndUpdate(
      { _id: id, parentId, isArchived: false },
      { $set: { isArchived: true } },
      options
    );
  }

  async countByParentId(parentId, session = null) {
    const query = Child.countDocuments({ parentId, isArchived: false });
    if (session) query.session(session);
    return query;
  }
}

export default new ChildRepository();

