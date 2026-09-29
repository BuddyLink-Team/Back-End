import userRepository from './user.repository.js';
import AppError from '../../shared/exceptions/AppError.js';

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
}

export default new UserService();
