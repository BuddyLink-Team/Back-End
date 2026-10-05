import User from './user.model.js';

class UserRepository {
  async findById(id) {
    return User.findOne({ _id: id, deletedAt: null });
  }

  async findByEmail(email) {
    return User.findOne({ email: email.toLowerCase(), deletedAt: null });
  }

  async findByPhone(phone) {
    return User.findOne({ phone, deletedAt: null });
  }

  async findByGoogleId(googleId) {
    return User.findOne({ googleId, deletedAt: null });
  }

  async create(userData) {
    return User.create(userData);
  }

  async updateById(id, updateData) {
    return User.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updatePhone(userId, phone) {
    // Unset instead of storing null: the sparse unique index on phone still indexes null values,
    // so a second user clearing their phone would hit a duplicate key error
    const update = phone ? { $set: { phone } } : { $unset: { phone: 1 } };
    return User.findOneAndUpdate({ _id: userId, deletedAt: null }, update, { new: true });
  }

  /**
   * Active, non-deleted user without the password hash (safe to attach to req/socket)
   */
  async findActiveSessionUser(id) {
    return User.findOne({ _id: id, deletedAt: null }).select('-passwordHash');
  }

  async hardDeleteById(id) {
    return User.deleteOne({ _id: id });
  }

  /**
   * One-off normalization of legacy upper-case roles ("PARENT"/"ADMIN") to lower case
   */
  async normalizeLegacyRoles() {
    // Use the raw collection: Mongoose casting applies the schema's `lowercase` setter to the
    // filter values too, which would turn ['PARENT', 'ADMIN'] into a filter matching nothing
    return User.collection.updateMany(
      { role: { $in: ['PARENT', 'ADMIN'] } },
      [{ $set: { role: { $toLower: '$role' } } }]
    );
  }

  async updatePassword(userId, passwordHash) {
    return User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { $set: { passwordHash } },
      { new: true }
    );
  }
}

export default new UserRepository();
