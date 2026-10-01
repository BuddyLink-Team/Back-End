import safetyRepository from './safety.repository.js';

class SafetyService {
  /**
   * Get all parentIds that the given parent has blocked or been blocked by.
   * Used by discovery module to exclude blocked users from results.
   * @param {string|mongoose.Types.ObjectId} parentId
   * @returns {Promise<string[]>}
   */
  async getBlockedParentIds(parentId) {
    return safetyRepository.getBlockedParentIds(parentId);
  }

  /**
   * Check if a block relationship exists between two parents (either direction).
   * @param {string|mongoose.Types.ObjectId} parentIdA
   * @param {string|mongoose.Types.ObjectId} parentIdB
   * @returns {Promise<boolean>}
   */
  async isBlocked(parentIdA, parentIdB) {
    return safetyRepository.isBlocked(parentIdA, parentIdB);
  }
}

export default new SafetyService();
