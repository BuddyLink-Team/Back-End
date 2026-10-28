import User from './user.model.js';
import { escapeRegExp } from '../../shared/helpers/regex.helper.js';

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

  /**
   * IDs (as strings) of the given users whose account is active and not deleted
   * @param {Array<string|ObjectId>} ids
   * @returns {Promise<string[]>}
   */
  async findActiveIdsByIds(ids) {
    const users = await User.find({ _id: { $in: ids }, isActive: true, deletedAt: null })
      .select('_id')
      .lean();
    return users.map((u) => u._id.toString());
  }

  /**
   * IDs of the accounts whose email contains the text (case-insensitive)
   * @returns {Promise<Array<ObjectId>>}
   */
  async findIdsByEmail(search, limit = 500) {
    const users = await User.find({ email: { $regex: escapeRegExp(search), $options: 'i' }, deletedAt: null })
      .select('_id')
      .limit(limit)
      .lean();
    return users.map((u) => u._id);
  }

  /**
   * Emails of several accounts
   * @returns {Promise<Array<{ _id: ObjectId, email: string }>>}
   */
  async findEmailsByIds(ids) {
    if (!ids.length) return [];
    return User.find({ _id: { $in: ids } }).select('email').lean();
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


  /**
   * Page of non-deleted accounts of one role (no password hash), newest first
   * @param {Object} options
   * @param {string} options.role
   * @param {boolean} [options.isActive]
   * @param {Array<string|ObjectId>|null} [options.restrictToIds] - Only these users; null = no restriction
   * @param {Array<string|ObjectId>|null} [options.excludeIds] - Never these users; null = no exclusion
   * @param {string} [options.search] - Matches the email or the phone
   * @param {Array<string|ObjectId>} [options.searchMatchIds] - Users also matched by the search elsewhere (e.g. parent name)
   * @param {number} options.page
   * @param {number} options.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPageByRole({ role, isActive, restrictToIds = null, excludeIds = null, search, searchMatchIds = [], page, limit }) {
    const filter = { role, deletedAt: null };
    if (typeof isActive === 'boolean') filter.isActive = isActive;
    if (restrictToIds || excludeIds) {
      filter._id = {
        ...(restrictToIds ? { $in: restrictToIds } : {}),
        ...(excludeIds ? { $nin: excludeIds } : {}),
      };
    }
    if (search) {
      const regex = new RegExp(escapeRegExp(search), 'i');
      filter.$or = [{ email: regex }, { phone: regex }, { _id: { $in: searchMatchIds } }];
    }

    const [items, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * Accounts of one role (deleted ones left out) by status
   * @param {string} role
   * @returns {Promise<{ total: number, active: number, locked: number }>}
   */
  async countByRoleAndStatus(role) {
    const rows = await User.aggregate([
      { $match: { role, deletedAt: null } },
      { $group: { _id: '$isActive', count: { $sum: 1 } } },
    ]);
    const active = rows.find((row) => row._id === true)?.count || 0;
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return { total, active, locked: total - active };
  }
}

export default new UserRepository();
