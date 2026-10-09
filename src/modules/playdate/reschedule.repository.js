import RescheduleRequest from './reschedule-request.model.js';
import { RESCHEDULE_STATUS, PARTICIPANT_STATUS } from './playdate.constants.js';

class RescheduleRepository {
  /**
   * Create a new reschedule request document
   * @param {Object} data
   * @returns {Promise<RescheduleRequest>}
   */
  async create(data) {
    return RescheduleRequest.create(data);
  }

  /**
   * Find reschedule request by ID with populated voters and requester
   * @param {string|ObjectId} id
   * @returns {Promise<RescheduleRequest|null>}
   */
  async findById(id) {
    return RescheduleRequest.findById(id)
      .populate('requestedBy', 'fullName avatarUrl verification')
      .populate('responses.parentId', 'fullName avatarUrl verification');
  }

  /**
   * Find one reschedule request matching query
   * @param {Object} query
   * @param {Object} sort
   * @returns {Promise<RescheduleRequest|null>}
   */
  async findOne(query, sort = { createdAt: -1 }) {
    return RescheduleRequest.findOne(query).sort(sort);
  }

  /**
   * Find latest reschedule request for a playdate with populated fields
   * @param {string|ObjectId} playdateId
   * @returns {Promise<RescheduleRequest|null>}
   */
  async findLatestByPlaydateId(playdateId) {
    return RescheduleRequest.findOne({ playdateId })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'fullName avatarUrl verification')
      .populate('responses.parentId', 'fullName avatarUrl verification');
  }

  /**
   * Find and atomically update a reschedule request
   * @param {Object} filter
   * @param {Object} update
   * @param {Object} options
   * @returns {Promise<RescheduleRequest|null>}
   */
  async findOneAndUpdate(filter, update, options = { new: true }) {
    return RescheduleRequest.findOneAndUpdate(filter, update, options);
  }

  /**
   * Cancel every pending reschedule request of a playdate
   * @param {string|ObjectId} playdateId
   */
  async cancelPendingByPlaydateId(playdateId) {
    return RescheduleRequest.updateMany(
      { playdateId, status: RESCHEDULE_STATUS.PENDING },
      { $set: { status: RESCHEDULE_STATUS.CANCELLED, resolvedAt: new Date() } },
    );
  }

  /**
   * Add a voter to the pending reschedule request of a playdate (if not already a voter)
   * @param {string|ObjectId} playdateId
   * @param {string|ObjectId} parentId
   */
  async addVoterToPending(playdateId, parentId) {
    return RescheduleRequest.updateOne(
      { playdateId, status: RESCHEDULE_STATUS.PENDING, 'responses.parentId': { $ne: parentId } },
      { $push: { responses: { parentId, status: PARTICIPANT_STATUS.PENDING, respondedAt: null } } },
    );
  }

  /**
   * Update multiple reschedule requests
   * @param {Object} filter
   * @param {Object} update
   * @returns {Promise<Object>}
   */
  async updateMany(filter, update) {
    return RescheduleRequest.updateMany(filter, update);
  }
}

export default new RescheduleRepository();
