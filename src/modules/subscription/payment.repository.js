import Payment from './payment.model.js';
import { PAYMENT_STATUS } from './subscription.constants.js';

// Payment link and raw PayOS data are never sent to the admin portal
const ADMIN_HIDDEN_FIELDS = '-checkoutUrl -qrCode -rawWebhookData';

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

  /**
   * Page of payments for the admin portal, newest first (payment link fields left out)
   * @param {Object} options
   * @param {string} [options.status]
   * @param {string} [options.planCode]
   * @param {Date} [options.fromDate] - Created at or after
   * @param {Date} [options.toDate] - Created at or before
   * @param {Array<ObjectId>|null} [options.searchParentIds] - Search box: payments of these parents...
   * @param {number|null} [options.searchOrderCode] - ...or the payment with this order code; null lists all
   * @param {number} options.page
   * @param {number} options.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findPageForAdmin({ status, planCode, fromDate, toDate, searchParentIds = null, searchOrderCode = null, page, limit }) {
    const filter = {};
    if (status) filter.status = status;
    if (planCode) filter['planSnapshot.planCode'] = planCode;
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) filter.createdAt.$gte = fromDate;
      if (toDate) filter.createdAt.$lte = toDate;
    }
    if (searchParentIds) {
      filter.$or = [{ parentId: { $in: searchParentIds } }];
      if (searchOrderCode !== null) filter.$or.push({ orderCode: searchOrderCode });
    }

    const [items, total] = await Promise.all([
      Payment.find(filter)
        .select(ADMIN_HIDDEN_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Payment.countDocuments(filter),
    ]);
    return { items, total };
  }

  /**
   * One payment for the admin portal (payment link fields left out)
   */
  async findByIdForAdmin(id) {
    return Payment.findById(id).select(ADMIN_HIDDEN_FIELDS).lean();
  }

  /**
   * Successful payments paid in a period: amount, count and distinct parents
   * @returns {Promise<{ totalRevenue: number, successfulTransactions: number, payingParentsCount: number }>}
   */
  async sumSuccessfulPaidBetween(fromDate, toDate) {
    const [row] = await Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.SUCCESS, paidAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          successfulTransactions: { $sum: 1 },
          parentIds: { $addToSet: '$parentId' },
        },
      },
    ]);
    return {
      totalRevenue: row?.totalRevenue || 0,
      successfulTransactions: row?.successfulTransactions || 0,
      payingParentsCount: row?.parentIds.length || 0,
    };
  }

  /**
   * Successful payments paid in a period, grouped by a date format in a time zone
   * @param {Date} fromDate
   * @param {Date} toDate
   * @param {string} dateFormat - e.g. '%Y-%m-%d', '%G-W%V', '%Y-%m'
   * @param {string} timeZone
   * @returns {Promise<Array<{ period: string, revenue: number, transactionCount: number }>>} sorted by period
   */
  async sumSuccessfulPaidByPeriod(fromDate, toDate, dateFormat, timeZone) {
    const rows = await Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.SUCCESS, paidAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$paidAt', timezone: timeZone } },
          revenue: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((row) => ({ period: row._id, revenue: row.revenue, transactionCount: row.transactionCount }));
  }

  /**
   * Successful payments paid in a period, grouped by calendar month in a time zone
   * @returns {Promise<Array<{ month: string, revenue: number, transactionCount: number }>>} month = 'YYYY-MM', sorted
   */
  async sumSuccessfulPaidByMonth(fromDate, toDate, timeZone) {
    const rows = await this.sumSuccessfulPaidByPeriod(fromDate, toDate, '%Y-%m', timeZone);
    return rows.map(({ period, revenue, transactionCount }) => ({ month: period, revenue, transactionCount }));
  }

  /**
   * Parents with at least one successful payment, ever
   */
  async countDistinctSuccessfulParents() {
    const parentIds = await Payment.distinct('parentId', { status: PAYMENT_STATUS.SUCCESS });
    return parentIds.length;
  }

  /**
   * Parents with a paid Premium period covering an instant
   */
  async countParentsWithGrantCovering(date) {
    const parentIds = await Payment.distinct('parentId', {
      status: PAYMENT_STATUS.SUCCESS,
      'grantResult.effectiveStartDate': { $lte: date },
      'grantResult.effectiveEndDate': { $gt: date },
    });
    return parentIds.length;
  }

  /**
   * Parents whose latest paid Premium period ends in [fromDate, toDate]
   */
  async countParentsWithLastGrantEndBetween(fromDate, toDate) {
    const [row] = await Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.SUCCESS, 'grantResult.effectiveEndDate': { $ne: null } } },
      { $group: { _id: '$parentId', lastEndDate: { $max: '$grantResult.effectiveEndDate' } } },
      { $match: { lastEndDate: { $gte: fromDate, $lte: toDate } } },
      { $count: 'count' },
    ]);
    return row?.count || 0;
  }

  /**
   * Parents with a successful payment on or before a date
   * @param {Date} date
   * @returns {Promise<number>}
   */
  async countDistinctSuccessfulParentsUntil(date) {
    const parentIds = await Payment.distinct('parentId', { status: PAYMENT_STATUS.SUCCESS, paidAt: { $lte: date } });
    return parentIds.length;
  }
}

export default new PaymentRepository();
