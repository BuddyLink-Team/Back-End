import bcrypt from 'bcryptjs';
import userRepository from './user.repository.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { UserProfileDTO } from './user.dto.js';

class UserService {
  async getUserById(id) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    return user;
  }

  async getUserByEmail(email) {
    return userRepository.findByEmail(email);
  }

  async getUserByPhone(phone) {
    return userRepository.findByPhone(phone);
  }

  async getUserByGoogleId(googleId) {
    return userRepository.findByGoogleId(googleId);
  }

  async createUser(data) {
    return userRepository.create(data);
  }

  async updatePhone(userId, phone) {
    return userRepository.updatePhone(userId, phone);
  }

  async updatePassword(userId, passwordHash) {
    return userRepository.updatePassword(userId, passwordHash);
  }

  async updateById(userId, updateData) {
    return userRepository.updateById(userId, updateData);
  }

  /**
   * Unified View Profile: automatically delegates if parent, or returns standard UserProfileDTO
   */
  async getMyProfile(userId) {
    const user = await this.getUserById(userId);
    const role = (user.role || '').toLowerCase();

    if (role === 'parent') {
      return parentService.getMyProfile(userId);
    }

    return UserProfileDTO.toResponse(user);
  }

  /**
   * Unified Update Profile: delegates to parentService if parent, otherwise updates user fields (e.g. phone)
   */
  async updateMyProfile(userId, updateData) {
    const user = await this.getUserById(userId);
    const role = (user.role || '').toLowerCase();

    // If phone is updated, update on User model
    if (updateData.phone !== undefined) {
      const trimmedPhone = updateData.phone ? updateData.phone.trim() : null;
      if (trimmedPhone) {
        const existingPhone = await this.getUserByPhone(trimmedPhone);
        if (existingPhone && existingPhone._id.toString() !== userId.toString()) {
          throw new AppError('Phone number is already in use', 409, 'PHONE_ALREADY_EXISTS');
        }
      }
      await this.updatePhone(userId, trimmedPhone);
    }

    if (role === 'parent') {
      return parentService.updateProfile(userId, updateData);
    }

    const updatedUser = await this.getUserById(userId);
    return UserProfileDTO.toResponse(updatedUser);
  }

  /**
   * Unified Update Avatar: delegates to parentService if parent
   */
  async updateMyAvatar(userId, fileBuffer) {
    const user = await this.getUserById(userId);
    const role = (user.role || '').toLowerCase();

    if (role === 'parent') {
      return parentService.updateAvatar(userId, fileBuffer);
    }

    throw new AppError('Avatar update is only supported for parent accounts', 400, 'OPERATION_NOT_SUPPORTED');
  }

  /**
   * Unified Change Password: works for any registered user
   */
  async changePassword(userId, { currentPassword, newPassword, confirmNewPassword }) {
    if (newPassword !== confirmNewPassword) {
      throw new AppError('Confirmation password does not match', 400, 'PASSWORD_MISMATCH');
    }

    const user = await this.getUserById(userId);
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (!user.passwordHash) {
      throw new AppError(
        'Account was registered using a social provider (Google). Password cannot be changed this way.',
        400,
        'SOCIAL_ACCOUNT_NO_PASSWORD'
      );
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new AppError('Incorrect current password', 400, 'INVALID_CURRENT_PASSWORD');
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) {
      throw new AppError('New password cannot be the same as current password', 400, 'SAME_AS_OLD_PASSWORD');
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await this.updatePassword(userId, newPasswordHash);

    return { success: true };
  }
}

export default new UserService();
