class NotificationDTO {
  /**
   * Convert notification Mongoose document to client-friendly response
   * @param {Object} notification
   * @returns {Object|null}
   */
  static toResponse(notification) {
    if (!notification) return null;

    const doc = notification.toObject ? notification.toObject() : notification;
    const rawSender = doc.data?.senderId;
    const rawPlaydate = doc.data?.playdateId;

    const sender =
      rawSender && typeof rawSender === 'object' && rawSender._id
        ? {
            id: rawSender._id.toString(),
            fullName: rawSender.fullName || '',
            avatarUrl: rawSender.avatarUrl || '',
          }
        : null;

    const playdate =
      rawPlaydate && typeof rawPlaydate === 'object' && rawPlaydate._id
        ? {
            id: rawPlaydate._id.toString(),
            activity: rawPlaydate.activity || '',
            scheduledDate: rawPlaydate.scheduledDate || null,
            time: rawPlaydate.time || null,
            location: rawPlaydate.location || null,
          }
        : null;

    return {
      id: doc._id?.toString() || doc.id,
      recipientId: doc.recipientId?._id?.toString() || doc.recipientId?.toString(),
      type: doc.type,
      title: doc.title,
      body: doc.body,
      data: {
        senderId: rawSender?._id?.toString() || (rawSender ? rawSender.toString() : null),
        sender,
        playdateId: rawPlaydate?._id?.toString() || (rawPlaydate ? rawPlaydate.toString() : null),
        playdate,
        conversationId: doc.data?.conversationId?.toString() || null,
        badgeCode: doc.data?.badgeCode || null,
      },
      isRead: Boolean(doc.isRead),
      readAt: doc.readAt || null,
      createdAt: doc.createdAt,
    };
  }

  /**
   * Convert an array of notifications
   * @param {Array<Object>} notifications
   * @returns {Array<Object>}
   */
  static toResponseList(notifications) {
    return (notifications || []).map((n) => NotificationDTO.toResponse(n));
  }
}

export default NotificationDTO;
