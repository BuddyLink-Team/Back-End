import playdateRepository from './playdate.repository.js';
import parentService from '../parent/parent.service.js';
import Child from '../child/child.model.js';
import Connection from '../connection/connection.model.js';
import { CONNECTION_STATUS } from '../connection/connection.constants.js';
import Subscription from '../subscription/subscription.model.js';
import {
  SUBSCRIPTION_PLAN_CODES,
  SUBSCRIPTION_STATUS,
  QUOTA_PERIOD_TYPES,
} from '../subscription/subscription.constants.js';
import UsageQuota from '../subscription/usage-quota.model.js';
import Conversation from '../chat/conversation.model.js';
import Message from '../chat/message.model.js';
import { CONVERSATION_TYPES, MESSAGE_TYPES } from '../chat/chat.constants.js';
import AppError from '../../shared/exceptions/AppError.js';
import { PlaydateResponseDTO } from './playdate.dto.js';
import { PLAYDATE_STATUS, PARTICIPANT_STATUS } from './playdate.constants.js';

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
   * Get friends of authenticated parent that can be invited to a playdate
   */
  async getInvitableFriends(userId) {
    const hostParentId = await this._getParentId(userId);

    const connections = await Connection.find({
      status: CONNECTION_STATUS.ACCEPTED,
      parents: hostParentId,
    }).populate('parents', 'fullName avatarUrl verification location');

    const friendParents = [];
    for (const conn of connections) {
      const other = conn.parents.find((p) => p._id.toString() !== hostParentId.toString());
      if (other) {
        friendParents.push(other);
      }
    }

    const friendParentIds = friendParents.map((p) => p._id);
    const children = await Child.find({
      parentId: { $in: friendParentIds },
      isArchived: false,
    }).select('parentId displayName dateOfBirth gender interests favoriteActivities personality avatarUrl');

    const childrenMap = {};
    for (const child of children) {
      const pid = child.parentId.toString();
      if (!childrenMap[pid]) childrenMap[pid] = [];
      childrenMap[pid].push({
        id: child._id.toString(),
        displayName: child.displayName,
        gender: child.gender,
        dateOfBirth: child.dateOfBirth,
        interests: child.interests || [],
      });
    }

    return friendParents.map((p) => ({
      id: p._id.toString(),
      fullName: p.fullName,
      avatarUrl: p.avatarUrl || '',
      isVerified: Boolean(p.verification?.isVerifiedParent),
      location: p.location || null,
      children: childrenMap[p._id.toString()] || [],
    }));
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
   * Includes:
   * 1. Friendship validation with invited parents
   * 2. Monthly quota check (max 3 playdates/month for Free tier)
   * 3. Automatic playdate chat group creation
   */
  async createPlaydate(userId, data) {
    const hostParentId = await this._getParentId(userId);

    // 1. Verify host child belongs to host parent and is not archived
    const hostChild = await Child.findOne({
      _id: data.hostChildId,
      parentId: hostParentId,
      isArchived: false,
    });
    if (!hostChild) {
      throw new AppError('Hồ sơ bé tham gia không hợp lệ hoặc không thuộc về bạn', 400, 'INVALID_HOST_CHILD');
    }

    // 2. Friendship validation: all invited participants must be accepted friends
    const participantsData = Array.isArray(data.participants) ? data.participants : [];
    const invitedParentIds = [
      ...new Set(
        participantsData
          .map((p) => (p.parentId?._id || p.parentId)?.toString())
          .filter((id) => Boolean(id) && id !== hostParentId.toString())
      ),
    ];

    if (invitedParentIds.length > 0) {
      const acceptedConnections = await Connection.find({
        status: CONNECTION_STATUS.ACCEPTED,
        parents: hostParentId,
      }).lean();

      const friendParentIdSet = new Set(
        acceptedConnections
          .flatMap((c) => c.parents.map((p) => p.toString()))
          .filter((id) => id !== hostParentId.toString())
      );

      const notFriend = invitedParentIds.find((id) => !friendParentIdSet.has(id));
      if (notFriend) {
        throw new AppError(
          'Chỉ có thể mời các phụ huynh đã kết nối bạn bè tham gia buổi hẹn',
          400,
          'NOT_CONNECTED_FRIEND'
        );
      }

      // Verify each invited child exists and belongs to invited parent
      for (const participant of participantsData) {
        const pParentId = participant.parentId?._id || participant.parentId;
        const pChildId = participant.childId?._id || participant.childId;
        if (pChildId && pParentId) {
          const childDoc = await Child.findOne({
            _id: pChildId,
            parentId: pParentId,
            isArchived: false,
          });
          if (!childDoc) {
            throw new AppError(
              'Hồ sơ bé được mời không tồn tại hoặc không hợp lệ',
              400,
              'INVALID_PARTICIPANT_CHILD'
            );
          }
        }
      }
    }

    // 3. Quota check: 3 playdates/month for Free plan
    const activeSubscription = await Subscription.findOne({
      parentId: hostParentId,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    const isPaidPlan =
      activeSubscription &&
      activeSubscription.planCode !== SUBSCRIPTION_PLAN_CODES.FREE &&
      (!activeSubscription.endDate || new Date(activeSubscription.endDate) > new Date());

    const currentPeriod = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    if (!isPaidPlan) {
      const usageQuota = await UsageQuota.findOne({
        parentId: hostParentId,
        periodType: QUOTA_PERIOD_TYPES.MONTHLY,
        periodValue: currentPeriod,
      });

      const playdatesCreatedCount = usageQuota?.counters?.playdatesCreated || 0;
      if (playdatesCreatedCount >= 3) {
        throw new AppError(
          'Bạn đã đạt giới hạn tạo 3 cuộc hẹn/tháng của gói Miễn phí. Vui lòng nâng cấp gói để tạo thêm.',
          403,
          'QUOTA_EXCEEDED'
        );
      }
    }

    // 4. Create playdate document
    const formattedParticipants = participantsData.map((p) => ({
      parentId: p.parentId?._id || p.parentId,
      childId: p.childId?._id || p.childId,
      status: PARTICIPANT_STATUS.PENDING,
      invitedAt: new Date(),
    }));

    const playdate = await playdateRepository.create({
      ...data,
      participants: formattedParticipants,
      hostParentId,
      status: PLAYDATE_STATUS.UPCOMING,
    });

    // Increment usage quota for the current month
    await UsageQuota.findOneAndUpdate(
      {
        parentId: hostParentId,
        periodType: QUOTA_PERIOD_TYPES.MONTHLY,
        periodValue: currentPeriod,
      },
      {
        $inc: { 'counters.playdatesCreated': 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 5. Auto-generate dedicated group chat room for the playdate
    try {
      const allParentIds = [
        hostParentId.toString(),
        ...participantsData.map((p) => (p.parentId?._id || p.parentId)?.toString()),
      ].filter(Boolean);
      const uniqueParentIds = [...new Set(allParentIds)];

      const conversation = await Conversation.create({
        type: CONVERSATION_TYPES.PLAYDATE,
        playdateId: playdate._id,
        participants: uniqueParentIds,
        isActive: true,
      });

      const initialMessage = await Message.create({
        conversationId: conversation._id,
        senderId: hostParentId,
        type: MESSAGE_TYPES.SYSTEM,
        content: `Buổi hẹn "${data.activity}" đã được tạo thành công. Các phụ huynh có thể trao đổi tại đây.`,
      });

      conversation.lastMessage = {
        messageId: initialMessage._id,
        senderId: hostParentId,
        content: initialMessage.content,
        type: MESSAGE_TYPES.SYSTEM,
        sentAt: new Date(),
      };
      await conversation.save();

      await playdateRepository.updateById(playdate._id, {
        chatConversationId: conversation._id,
      });
    } catch (chatError) {
      // Chat room creation should not crash playdate creation, but log warning
      // logger can record if needed
    }

    const populated = await playdateRepository.findById(playdate._id);
    return PlaydateResponseDTO.toResponse(populated, hostParentId);
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
