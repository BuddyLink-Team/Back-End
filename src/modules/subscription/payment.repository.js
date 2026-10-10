import Payment from './payment.model.js';

class PaymentRepository {
  /**
   * Create a new payment record
   */
  async create(paymentData, session = null) {
    if (session) {
      const created = await Payment.create([paymentData], { session });
      return created[0];
    }
    return Payment.create(paymentData);
  }

  /**
   * Find payment by orderCode
   */
  async findByOrderCode(orderCode, session = null) {
    const query = Payment.findOne({ orderCode: Number(orderCode) });
    if (session) {
      query.session(session);
    }
    return query;
  }

  /**
   * Find payment by ID
   */
  async findById(id, session = null) {
    const query = Payment.findById(id);
    if (session) {
      query.session(session);
    }
    return query;
  }

  /**
   * Find payment by parentId and idempotency key
   */
  async findByParentAndIdempotencyKey(parentId, idempotencyKey) {
    if (!idempotencyKey) return null;
    return Payment.findOne({ parentId, idempotencyKey });
  }

  /**
   * Conditionally fulfill payment: only if status is not already 'success' and fulfilledAt is null
   */
  async fulfillPayment(orderCode, updateData, session = null) {
    const options = { new: true };
    if (session) {
      options.session = session;
    }
    return Payment.findOneAndUpdate(
      {
        orderCode: Number(orderCode),
        status: { $ne: 'success' },
        fulfilledAt: null,
      },
      { $set: updateData },
      options
    );
  }

  /**
   * Update payment status only if not already in 'success' state (prevent status downgrade)
   */
  async updateNonSuccessStatus(orderCode, updateData, session = null) {
    const options = { new: true };
    if (session) {
      options.session = session;
    }
    return Payment.findOneAndUpdate(
      {
        orderCode: Number(orderCode),
        status: { $ne: 'success' },
      },
      { $set: updateData },
      options
    );
  }

  /**
   * Update payment by orderCode
   */
  async updateByOrderCode(orderCode, updateData, session = null) {
    const options = { new: true };
    if (session) {
      options.session = session;
    }
    return Payment.findOneAndUpdate(
      { orderCode: Number(orderCode) },
      { $set: updateData },
      options
    );
  }

  /**
   * Update payment by ID
   */
  async updateById(id, updateData, session = null) {
    const options = { new: true };
    if (session) {
      options.session = session;
    }
    return Payment.findByIdAndUpdate(id, { $set: updateData }, options);
  }


  /**
   * Find paginated payment history for a parent
   */
  /**
   * Unpaid orders whose payment link has expired (still 'creating' / 'pending' in the database)
   * @param {{ parentId?: string|ObjectId, now?: Date, limit?: number }} [options] - All parents when no parentId
   * @returns {Promise<Array<Object>>} Oldest first
   */
  async findStaleUnpaid({ parentId, now = new Date(), limit = 50 } = {}) {
    return Payment.find({
      ...(parentId ? { parentId } : {}),
      status: { $in: ['creating', 'pending'] },
      expiresAt: { $lte: now },
    })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .lean();
  }

    async findHistoryByParentId(parentId, { page = 1, limit = 10 } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (parsedPage - 1) * parsedLimit;

    const filter = { parentId };

    const [items, total] = await Promise.all([
      Payment.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Payment.countDocuments(filter),
    ]);

    return {
      items,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }
}

export default new PaymentRepository();
