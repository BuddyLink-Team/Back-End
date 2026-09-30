import Parent from './parent.model.js';

class ParentRepository {
  async findByUserId(userId) {
    return Parent.findOne({ userId });
  }

  async findById(id) {
    return Parent.findById(id);
  }

  async create(parentData) {
    return Parent.create(parentData);
  }

  async updateByUserId(userId, updateData) {
    return Parent.findOneAndUpdate(
      { userId },
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updateVerification(userId, verificationUpdates) {
    const parent = await Parent.findOne({ userId });
    if (!parent) return null;

    const currentVerification = parent.verification || {};
    const newVerification = {
      ...currentVerification,
      ...verificationUpdates,
    };

    if (newVerification.isEmailVerified && newVerification.isPhoneVerified) {
      newVerification.isVerifiedParent = true;
    }

    parent.verification = newVerification;
    return parent.save();
  }
}

export default new ParentRepository();
