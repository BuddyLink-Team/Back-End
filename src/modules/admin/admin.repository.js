import User from '../user/user.model.js';
import Child from '../child/child.model.js';
import { escapeRegExp } from '../../shared/helpers/regex.helper.js';

class AdminRepository {
  /**
   * Find paginated parent users joined with Parent profile, children count and subscription
   * @param {Object} options
   * @param {string} [options.search]
   * @param {boolean|string} [options.isActive]
   * @param {boolean|string} [options.isVerified]
   * @param {number} [options.page=1]
   * @param {number} [options.limit=10]
   * @returns {Promise<{items: Array, pagination: Object}>}
   */
  async findUsersPaginated({ search, isActive, isVerified, page = 1, limit = 10 } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (parsedPage - 1) * parsedLimit;

    const userMatch = {
      role: 'parent',
      deletedAt: null,
    };

    if (isActive !== undefined && isActive !== '') {
      userMatch.isActive = isActive === true || isActive === 'true';
    }

    const pipeline = [
      { $match: userMatch },
      {
        $lookup: {
          from: 'parents',
          localField: '_id',
          foreignField: 'userId',
          as: 'parent',
        },
      },
      {
        $unwind: {
          path: '$parent',
          preserveNullAndEmptyArrays: false,
        },
      },
    ];

    const postMatch = {};

    if (isVerified !== undefined && isVerified !== '') {
      postMatch['parent.verification.isVerifiedParent'] = isVerified === true || isVerified === 'true';
    }

    if (search && search.trim()) {
      const escaped = escapeRegExp(search.trim());
      const regex = new RegExp(escaped, 'i');
      postMatch.$or = [
        { email: regex },
        { phone: regex },
        { 'parent.fullName': regex },
      ];
    }

    if (Object.keys(postMatch).length > 0) {
      pipeline.push({ $match: postMatch });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'children',
          let: { parentId: '$parent._id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$parentId', '$$parentId'] },
                    { $eq: ['$isArchived', false] },
                  ],
                },
              },
            },
            { $count: 'count' },
          ],
          as: 'childrenCount',
        },
      },
      {
        $lookup: {
          from: 'subscriptions',
          localField: 'parent._id',
          foreignField: 'parentId',
          as: 'subscription',
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: parsedLimit }],
        },
      }
    );

    const result = await User.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const items = result[0]?.data || [];

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
   * Find paginated children joined with parent information
   * @param {Object} options
   * @param {string} [options.search]
   * @param {string} [options.gender]
   * @param {number|string} [options.minAge]
   * @param {number|string} [options.maxAge]
   * @param {boolean|string} [options.isArchived]
   * @param {number} [options.page=1]
   * @param {number} [options.limit=10]
   * @returns {Promise<{items: Array, pagination: Object}>}
   */
  async findChildrenPaginated({ search, gender, minAge, maxAge, isArchived, page = 1, limit = 10 } = {}) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (parsedPage - 1) * parsedLimit;

    const childMatch = {};

    if (gender) {
      childMatch.gender = gender;
    }

    if (isArchived !== undefined && isArchived !== '') {
      childMatch.isArchived = isArchived === true || isArchived === 'true';
    }

    if (minAge !== undefined || maxAge !== undefined) {
      const now = new Date();
      childMatch.dateOfBirth = {};

      if (maxAge !== undefined && maxAge !== '') {
        const parsedMaxAge = parseInt(maxAge, 10);
        childMatch.dateOfBirth.$gt = new Date(
          now.getFullYear() - parsedMaxAge - 1,
          now.getMonth(),
          now.getDate()
        );
      }

      if (minAge !== undefined && minAge !== '') {
        const parsedMinAge = parseInt(minAge, 10);
        childMatch.dateOfBirth.$lte = new Date(
          now.getFullYear() - parsedMinAge,
          now.getMonth(),
          now.getDate()
        );
      }
    }

    const pipeline = [
      { $match: childMatch },
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
    ];

    if (search && search.trim()) {
      const escaped = escapeRegExp(search.trim());
      const regex = new RegExp(escaped, 'i');
      pipeline.push({
        $match: {
          $or: [
            { displayName: regex },
            { 'parent.fullName': regex },
          ],
        },
      });
    }

    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: parsedLimit }],
        },
      }
    );

    const result = await Child.aggregate(pipeline);
    const total = result[0]?.metadata[0]?.total || 0;
    const items = result[0]?.data || [];

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

export default new AdminRepository();
