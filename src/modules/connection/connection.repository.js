import Connection from './connection.model.js';
import { CONNECTION_STATUS } from './connection.constants.js';

class ConnectionRepository {
  async create(data) {
    return Connection.create(data);
  }

  async findById(connectionId) {
    return Connection.findById(connectionId);
  }

  async findByParents(parentIdA, parentIdB) {
    return Connection.findOne({
      parents: { $all: [parentIdA, parentIdB] },
      status: { $in: [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED] },
    });
  }

  async updateStatus(connectionId, status) {
    const updateData = { status };
    if (status === CONNECTION_STATUS.ACCEPTED) {
      updateData.connectedAt = new Date();
    } else if (status === CONNECTION_STATUS.DECLINED) {
      updateData.declinedAt = new Date();
    } else if (status === CONNECTION_STATUS.REMOVED) {
      updateData.removedAt = new Date();
    }
    
    return Connection.findByIdAndUpdate(connectionId, updateData, { new: true });
  }

  async getConnectionsByParent(parentId, status) {
    const query = { parents: parentId };
    if (status) {
      query.status = status;
    }
    
    return Connection.find(query)
      .populate('requesterId', 'fullName avatarUrl privacySettings location verification preferences')
      .populate('recipientId', 'fullName avatarUrl privacySettings location verification preferences')
      .sort({ createdAt: -1 });
  }
}

export default new ConnectionRepository();
