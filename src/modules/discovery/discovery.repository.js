import Swipe from './discovery.model.js';

class DiscoveryRepository {
  /**
   * Get all child IDs that a parent has already swiped on
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @returns {Promise<string[]>}
   */
  async getSwipedChildIds(swiperParentId) {
    const swipes = await Swipe.find({ swiperParentId }).select('targetChildId');
    return swipes.map((s) => s.targetChildId.toString());
  }

  /**
   * Create a new swipe record (Like or Pass)
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId} targetChildId
   * @param {string|mongoose.Types.ObjectId} targetParentId
   * @param {boolean} isLike
   * @returns {Promise<Object>}
   */
  async createSwipe(swiperParentId, targetChildId, targetParentId, isLike) {
    return Swipe.create({
      swiperParentId,
      targetChildId,
      targetParentId,
      isLike,
    });
  }

  /**
   * Check if a swipe already exists for a specific child
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId} targetChildId
   * @returns {Promise<Object|null>}
   */
  async findExistingSwipe(swiperParentId, targetChildId) {
    return Swipe.findOne({ swiperParentId, targetChildId });
  }
}

export default new DiscoveryRepository();
