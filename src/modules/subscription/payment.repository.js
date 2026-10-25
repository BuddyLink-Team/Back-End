import mongoose from 'mongoose';
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

  /**
   * Paginated list of payments with parent and user lookup for admin portal
   */
  async findPaginated({ status, planCode, parentId, fromDate, toDate, search, page = 1, limit = 10 } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (parsedPage - 1) * parsedLimit;

    const pipeline = [
      {
        $lookup: {
          from: 'parents',
          localField: 'parentId',
          foreignField: '_id',
          as: 'parent',
        },
      },
      {
        $unwind: {
          path: '$parent',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'parent.userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    const matchConditions = {};

    if (status) {
      matchConditions.status = status;
    }

    if (planCode) {
      matchConditions['planSnapshot.planCode'] = planCode;
    }

    if (parentId) {
      matchConditions.parentId = mongoose.Types.ObjectId.isValid(parentId)
        ? new mongoose.Types.ObjectId(parentId)
        : parentId;
    }

    if (fromDate || toDate) {
      matchConditions.createdAt = {};
      if (fromDate) matchConditions.createdAt.$gte = new Date(fromDate);
      if (toDate) matchConditions.createdAt.$lte = new Date(toDate);
    }

    if (search && search.trim()) {
      const trimmed = search.trim();
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const orConditions = [
        { 'parent.fullName': { $regex: escaped, $options: 'i' } },
        { 'user.email': { $regex: escaped, $options: 'i' } },
      ];
      if (!isNaN(Number(trimmed))) {
        orConditions.unshift({ orderCode: Number(trimmed) });
      }
      matchConditions.$or = orConditions;
    }

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    pipeline.push({
      $facet: {
        items: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: parsedLimit },
          {
            $project: {
              _id: 1,
              orderCode: 1,
              parentId: 1,
              subscriptionId: 1,
              planSnapshot: 1,
              amount: 1,
              currency: 1,
              status: 1,
              paymentMethod: 1,
              grantResult: 1,
              paidAt: 1,
              createdAt: 1,
              parent: {
                _id: '$parent._id',
                fullName: '$parent.fullName',
                avatarUrl: '$parent.avatarUrl',
                email: '$user.email',
              },
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    });

    const result = await Payment.aggregate(pipeline);
    const items = result[0]?.items || [];
    const total = result[0]?.totalCount[0]?.count || 0;

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
   * Find single payment detail for admin audit (stripping checkoutUrl and qrCode)
   */
  async findByIdWithDetail(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;

    const result = await Payment.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(id) } },
      {
        $lookup: {
          from: 'parents',
          localField: 'parentId',
          foreignField: '_id',
          as: 'parent',
        },
      },
      {
        $unwind: {
          path: '$parent',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'parent.userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          orderCode: 1,
          transactionId: 1,
          parentId: 1,
          subscriptionId: 1,
          planSnapshot: 1,
          amount: 1,
          currency: 1,
          status: 1,
          paymentMethod: 1,
          bankInfo: 1,
          expiresAt: 1,
          paidAt: 1,
          fulfilledAt: 1,
          failureReason: 1,
          grantResult: 1,
          createdAt: 1,
          updatedAt: 1,
          parent: {
            _id: '$parent._id',
            fullName: '$parent.fullName',
            avatarUrl: '$parent.avatarUrl',
            email: '$user.email',
          },
          // checkoutUrl and qrCode are intentionally omitted
        },
      },
    ]);

    return result[0] || null;
  }

  /**
   * Get revenue aggregation and statistics for admin portal
   */
  async getRevenueMetrics({ fromDate, toDate }) {
    const successMatch = {
      status: 'success',
      paidAt: { $gte: fromDate, $lte: toDate },
    };

    const [overviewAgg, monthlyAgg, allPayingParents, activeAtStart, churnedInPeriod] = await Promise.all([
      Payment.aggregate([
        { $match: successMatch },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            successfulTransactions: { $sum: 1 },
            payingParents: { $addToSet: '$parentId' },
          },
        },
      ]),
      Payment.aggregate([
        { $match: successMatch },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m', date: '$paidAt', timezone: '+07:00' },
            },
            revenue: { $sum: '$amount' },
            transactionCount: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // All-time distinct paying parents (with at least 1 success payment)
      Payment.distinct('parentId', { status: 'success' }),
      // Parents with an active Premium period at fromDate (Denominator for churn rate)
      Payment.distinct('parentId', {
        status: 'success',
        'grantResult.effectiveStartDate': { $lte: fromDate },
        'grantResult.effectiveEndDate': { $gt: fromDate },
      }),
      // Parents whose last Premium period ended within [fromDate, toDate] (Numerator for churn rate)
      Payment.aggregate([
        { $match: { status: 'success', 'grantResult.effectiveEndDate': { $ne: null } } },
        {
          $group: {
            _id: '$parentId',
            lastEffectiveEndDate: { $max: '$grantResult.effectiveEndDate' },
          },
        },
        {
          $match: {
            lastEffectiveEndDate: { $gte: fromDate, $lte: toDate },
          },
        },
      ]),
    ]);

    const overviewData = overviewAgg[0] || {
      totalRevenue: 0,
      successfulTransactions: 0,
      payingParents: [],
    };

    return {
      totalRevenue: overviewData.totalRevenue || 0,
      successfulTransactions: overviewData.successfulTransactions || 0,
      payingParentsCount: overviewData.payingParents?.length || 0,
      allTimePayingParentsCount: allPayingParents.length,
      monthlyRevenue: monthlyAgg.map((item) => ({
        month: item._id,
        label: `T${item._id.split('-')[1]}/${item._id.split('-')[0]}`,
        revenue: item.revenue,
        transactionCount: item.transactionCount,
      })),
      activeParentsAtStartCount: activeAtStart.length,
      churnedParentsCount: churnedInPeriod.length,
    };
  }
}

export default new PaymentRepository();
