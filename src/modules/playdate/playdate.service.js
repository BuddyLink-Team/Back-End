import playdateRepository from './playdate.repository.js';
import parentService from '../parent/parent.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { PlaydateResponseDTO } from './playdate.dto.js';
import { PLAYDATE_STATUS } from './playdate.constants.js';

class PlaydateService {
  /**
   * Helper to resolve parent._id from authenticated req.userId
   */
  async _getParentId(userId) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Hồ sơ phụ huynh không tồn tại', 404, 'PARENT_NOT_FOUND');
    }
    return parent._id;
  }

  /**
   * Get playdates for authenticated parent with status filter and counts
   */
  async getPlaydates(userId, query = {}) {
    const parentId = await this._getParentId(userId);
    const playdates = await playdateRepository.findForParent(parentId, query);
    const counts = await playdateRepository.countByStatusesForParent(parentId);

    return {
      playdates: PlaydateResponseDTO.toResponseList(playdates, parentId),
      counts,
    };
  }

  /**
   * Get single playdate detail by ID
   */
  async getPlaydateById(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Không tìm thấy buổi hẹn chơi', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    const isHost = hostParentIdStr === parentId.toString();
    const isParticipant = playdate.participants?.some(
      (p) => (p.parentId?._id || p.parentId)?.toString() === parentId.toString()
    );

    if (!isHost && !isParticipant) {
      throw new AppError('Bạn không có quyền xem thông tin buổi hẹn này', 403, 'FORBIDDEN');
    }

    return PlaydateResponseDTO.toResponse(playdate, parentId);
  }

  /**
   * Complete a playdate (Host only)
   */
  async completePlaydate(userId, id) {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Không tìm thấy buổi hẹn chơi', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    if (hostParentIdStr !== parentId.toString()) {
      throw new AppError('Chỉ người tổ chức (host) mới có quyền hoàn thành buổi hẹn chơi', 403, 'FORBIDDEN');
    }

    if (playdate.status === PLAYDATE_STATUS.CANCELLED) {
      throw new AppError('Không thể hoàn thành buổi hẹn đã bị hủy', 400, 'INVALID_PLAYDATE_STATUS');
    }

    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      return PlaydateResponseDTO.toResponse(playdate, parentId);
    }

    const updated = await playdateRepository.updateById(id, {
      status: PLAYDATE_STATUS.COMPLETED,
      completedAt: new Date(),
    });

    return PlaydateResponseDTO.toResponse(updated, parentId);
  }

  /**
   * Create a new playdate
   */
  async createPlaydate(userId, data) {
    const parentId = await this._getParentId(userId);

    const playdate = await playdateRepository.create({
      ...data,
      hostParentId: parentId,
      status: PLAYDATE_STATUS.UPCOMING,
    });

    const populated = await playdateRepository.findById(playdate._id);
    return PlaydateResponseDTO.toResponse(populated, parentId);
  }

  /**
   * Cancel a playdate (Host only)
   */
  async cancelPlaydate(userId, id, reason = '') {
    const parentId = await this._getParentId(userId);
    const playdate = await playdateRepository.findById(id);

    if (!playdate) {
      throw new AppError('Không tìm thấy buổi hẹn chơi', 404, 'PLAYDATE_NOT_FOUND');
    }

    const hostParentIdStr = (playdate.hostParentId?._id || playdate.hostParentId)?.toString();
    if (hostParentIdStr !== parentId.toString()) {
      throw new AppError('Chỉ người tổ chức (host) mới có quyền hủy buổi hẹn', 403, 'FORBIDDEN');
    }

    if (playdate.status === PLAYDATE_STATUS.COMPLETED) {
      throw new AppError('Không thể hủy buổi hẹn đã hoàn thành', 400, 'INVALID_PLAYDATE_STATUS');
    }

    const updated = await playdateRepository.updateById(id, {
      status: PLAYDATE_STATUS.CANCELLED,
      cancellation: {
        cancelledBy: parentId,
        reason: reason || 'Hủy bởi người tổ chức',
        cancelledAt: new Date(),
      },
    });

    return PlaydateResponseDTO.toResponse(updated, parentId);
  }
}

export default new PlaydateService();
