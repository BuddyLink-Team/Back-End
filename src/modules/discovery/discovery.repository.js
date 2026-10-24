import Swipe from './discovery.model.js';

class DiscoveryRepository {
  /**
   * Get the child IDs that a parent has already swiped on
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId|null} [forChildId] - Only swipes made for this own child
   *   (legacy swipes without a child count for every child); omitted: every swipe of the parent
   * @returns {Promise<string[]>}
   */
  async getSwipedChildIds(swiperParentId, forChildId = null) {
    const query = { swiperParentId };
    if (forChildId) query.forChildId = { $in: [forChildId, null] };
    const swipeTargets = await Swipe.distinct('targetChildId', query);
    return swipeTargets.map((id) => id.toString());
  }

  /**
   * Create a new swipe record (Like or Pass)
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId} targetChildId
   * @param {string|mongoose.Types.ObjectId} targetParentId
   * @param {boolean} isLike
   * @param {string|mongoose.Types.ObjectId} forChildId - Own child the swipe is for
   * @returns {Promise<Object>}
   */
  async createSwipe(swiperParentId, targetChildId, targetParentId, isLike, forChildId) {
    return Swipe.create({
      swiperParentId,
      targetChildId,
      targetParentId,
      isLike,
      forChildId,
    });
  }

  /**
   * Check if a swipe already exists on a child for one own child
   * (a legacy swipe without a child counts for every child)
   * @param {string|mongoose.Types.ObjectId} swiperParentId
   * @param {string|mongoose.Types.ObjectId} targetChildId
   * @param {string|mongoose.Types.ObjectId} forChildId
   * @returns {Promise<Object|null>}
   */
  async findExistingSwipe(swiperParentId, targetChildId, forChildId) {
    return Swipe.findOne({ swiperParentId, targetChildId, forChildId: { $in: [forChildId, null] } });
  }
}

export default new DiscoveryRepository();
