export class ChatDTO {
  static formatParticipant(participant) {
    if (!participant) return null;
    return {
      id: participant._id?.toString() || participant.id || participant,
      fullName: participant.fullName || 'Người dùng',
      avatarUrl: participant.avatarUrl || '',
      verification: {
        isVerifiedParent: Boolean(participant.verification?.isVerifiedParent),
        isEmailVerified: Boolean(participant.verification?.isEmailVerified),
        isPhoneVerified: Boolean(participant.verification?.isPhoneVerified),
      },
      location: participant.location || {},
    };
  }

  static formatPlaydate(playdate) {
    if (!playdate) return null;
    if (typeof playdate === 'string' || !playdate._id) {
      return { id: playdate.toString ? playdate.toString() : playdate };
    }

    const hostParent = this.formatParticipant(playdate.hostParentId);
    const hostChild = playdate.hostChildId && typeof playdate.hostChildId === 'object'
      ? {
          id: playdate.hostChildId._id?.toString() || playdate.hostChildId.id,
          displayName: playdate.hostChildId.displayName || '',
          dateOfBirth: playdate.hostChildId.dateOfBirth,
          gender: playdate.hostChildId.gender,
          interests: playdate.hostChildId.interests || [],
        }
      : null;

    const participants = (playdate.participants || []).map((p) => ({
      parent: this.formatParticipant(p.parentId),
      child: p.childId && typeof p.childId === 'object'
        ? {
            id: p.childId._id?.toString() || p.childId.id,
            displayName: p.childId.displayName || '',
            dateOfBirth: p.childId.dateOfBirth,
            gender: p.childId.gender,
            interests: p.childId.interests || [],
          }
        : null,
      status: p.status,
      invitedAt: p.invitedAt,
      respondedAt: p.respondedAt,
    }));

    return {
      id: playdate._id?.toString() || playdate.id,
      title: playdate.activity || playdate.title || 'Cuộc hẹn chơi',
      activity: playdate.activity || '',
      scheduledDate: playdate.scheduledDate,
      time: playdate.time || '',
      location: playdate.location || {},
      note: playdate.note || '',
      status: playdate.status || 'upcoming',
      host: hostParent,
      hostChild,
      participants,
    };
  }

  static toConversationResponse(conversation, currentParentId) {
    if (!conversation) return null;

    const currentParentIdStr = currentParentId?.toString();
    const participants = (conversation.participants || []).map((p) => this.formatParticipant(p));

    // Identify the other participant in direct conversations
    const partner = participants.find((p) => p.id !== currentParentIdStr) || participants[0] || null;

    // Get unread count for current parent
    let unreadCount = 0;
    if (conversation.unreadCounts) {
      if (conversation.unreadCounts instanceof Map) {
        unreadCount = conversation.unreadCounts.get(currentParentIdStr) || 0;
      } else if (typeof conversation.unreadCounts === 'object') {
        unreadCount = conversation.unreadCounts[currentParentIdStr] || 0;
      }
    }

    return {
      id: conversation._id?.toString() || conversation.id,
      type: conversation.type,
      participants,
      partner,
      playdate: this.formatPlaydate(conversation.playdateId),
      lastMessage: conversation.lastMessage
        ? {
            messageId: conversation.lastMessage.messageId?.toString() || null,
            senderId: conversation.lastMessage.senderId?._id?.toString() || conversation.lastMessage.senderId?.toString() || null,
            senderName: conversation.lastMessage.senderId?.fullName || '',
            content: conversation.lastMessage.content || '',
            type: conversation.lastMessage.type || 'text',
            sentAt: conversation.lastMessage.sentAt || conversation.updatedAt,
          }
        : null,
      unreadCount,
      isActive: conversation.isActive,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  static toConversationListResponse(conversations, currentParentId) {
    if (!Array.isArray(conversations)) return [];
    return conversations.map((c) => this.toConversationResponse(c, currentParentId));
  }

  static toMessageResponse(message, currentParentId) {
    if (!message) return null;

    const currentParentIdStr = currentParentId?.toString();
    const senderId = message.senderId?._id?.toString() || message.senderId?.toString();

    const isMine = senderId === currentParentIdStr;
    const isRead = Array.isArray(message.readBy) && message.readBy.some((r) => r.parentId?.toString() !== senderId);

    return {
      id: message._id?.toString() || message.id,
      conversationId: message.conversationId?.toString(),
      sender: message.senderId && typeof message.senderId === 'object'
        ? this.formatParticipant(message.senderId)
        : { id: senderId },
      senderId,
      type: message.type || 'text',
      content: message.content || '',
      mediaUrl: message.mediaUrl || null,
      isMine,
      isRead,
      readBy: message.readBy || [],
      createdAt: message.createdAt,
    };
  }

  static toMessageListResponse(messages, currentParentId) {
    if (!Array.isArray(messages)) return [];
    return messages.map((m) => this.toMessageResponse(m, currentParentId));
  }
}

export default ChatDTO;
