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
    return User.findOneAndUpdate(
      { _id: userId, deletedAt: null },
      { $set: { phone } },
      { new: true }
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
