import mongoose from "mongoose";
import Block from "./block.model.js";
import Report from "./report.model.js";
import { escapeRegExp } from "../../shared/helpers/regex.helper.js";
import {
  CATEGORY_TO_SEVERITY,
  REPORT_CLOSED_STATUSES,
  REPORT_OPEN_STATUSES,
  REPORT_SEVERITY,
  REPORT_SEVERITY_WEIGHTS,
  REPORT_SORTS,
  REPORT_STATUS,
} from "./safety.constants.js";

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

const REPORT_SORT_STAGES = Object.freeze({
  [REPORT_SORTS.QUEUE]: { severityWeight: -1, createdAt: 1, _id: 1 },
  [REPORT_SORTS.NEWEST]: { createdAt: -1, _id: -1 },
  [REPORT_SORTS.OLDEST]: { createdAt: 1, _id: 1 },
});

const SEVERITY_WEIGHT_FIELD = {
  $switch: {
    branches: Object.entries(REPORT_SEVERITY_WEIGHTS).map(([severity, weight]) => ({
      case: { $eq: ["$severity", severity] },
      then: weight,
    })),
    default: REPORT_SEVERITY_WEIGHTS[REPORT_SEVERITY.MEDIUM],
  },
};

// Aggregations do not cast values as queries do, so every id here is an ObjectId
const toCreatedAtFilter = ({ from, to }) => {
  if (!from && !to) return {};
  return { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
};

const toOverdueFilter = ({ critical, regular }) => ({
  status: { $in: REPORT_OPEN_STATUSES },
  $or: [
    { severity: REPORT_SEVERITY.CRITICAL, createdAt: { $lt: critical } },
    { severity: { $ne: REPORT_SEVERITY.CRITICAL }, createdAt: { $lt: regular } },
  ],
});

// Same rule as caseKeyOf (enforcement-metrics.rules.js), for aggregations
const CASE_KEY_FIELD = {
  $switch: {
    branches: [
      { case: { $ne: [{ $ifNull: ["$targetPlaydateId", null] }, null] }, then: { $concat: ["playdate:", { $toString: "$targetPlaydateId" }] } },
      { case: { $ne: [{ $ifNull: ["$targetMessageId", null] }, null] }, then: { $concat: ["message:", { $toString: "$targetMessageId" }] } },
    ],
    default: { $concat: ["user:", { $toString: "$reportedUserId" }, ":", "$category"] },
  },
};

// One row of the queue: the open reports of a case together, and the reports closed by one decision together
const CASE_GROUP_FIELD = {
  $cond: [
    { $in: ["$status", REPORT_OPEN_STATUSES] },
    { $concat: ["open:", CASE_KEY_FIELD] },
    { $concat: ["closed:", { $toString: { $ifNull: ["$closedCaseId", "$_id"] } }] },
  ],
};

/**
 * Query matching the reports of the same case as a report (see caseKeyOf)
 * @param {Object} report
 */
const toCaseFilter = (report) => {
  if (report.targetPlaydateId) return { targetPlaydateId: report.targetPlaydateId };
  if (report.targetMessageId) return { targetMessageId: report.targetMessageId };
  return { reportedUserId: report.reportedUserId, category: report.category, targetPlaydateId: null, targetMessageId: null };
};

const countCases = async (match) => {
  const [row] = await Report.aggregate([
    { $match: match },
    { $group: { _id: CASE_GROUP_FIELD } },
    { $count: "count" },
  ]);
  return row?.count || 0;
};

const countByField = async (match, field) => {
  const rows = await Report.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
};

class SafetyRepository {
  /**
   * Get all parentIds that the given parent has blocked or been blocked by.
   * Returns a deduplicated array of ObjectId strings excluding the caller.
   * @param {string|mongoose.Types.ObjectId} parentId
   * @returns {Promise<string[]>}
   */
  async getBlockedParentIds(parentId) {
    const blocks = await Block.find({
      $or: [{ blockerId: parentId }, { blockedId: parentId }],
    }).select("blockerId blockedId");

    const ids = new Set();
    blocks.forEach((b) => {
      ids.add(b.blockerId.toString());
      ids.add(b.blockedId.toString());
    });
    ids.delete(parentId.toString());
    return [...ids];
  }


  /**
   * Create or update the block from one parent to another
   * @param {string|ObjectId} blockerId
   * @param {string|ObjectId} blockedId
   * @param {string} reason
   * @returns {Promise<Object>}
   */
  async upsertBlock(blockerId, blockedId, reason) {
    return Block.findOneAndUpdate(
      { blockerId, blockedId },
      { $set: { reason } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  /**
   * Remove the block from one parent to another
   * @param {string|ObjectId} blockerId
   * @param {string|ObjectId} blockedId
   */
  async deleteBlock(blockerId, blockedId) {
    return Block.findOneAndDelete({ blockerId, blockedId });
  }

  /**
   * Find any block between a parent and one of the given parents (in either direction)
   * @param {string|ObjectId} parentId
   * @param {Array<string|ObjectId>} otherParentIds
   * @returns {Promise<Object|null>}
   */
  async findBlockBetween(parentId, otherParentIds) {
    return Block.findOne({
      $or: [
        { blockerId: parentId, blockedId: { $in: otherParentIds } },
        { blockerId: { $in: otherParentIds }, blockedId: parentId },
      ],
    }).lean();
  }

  /**
   * Check whether a parent blocked one of the given parents (that direction only)
   * @param {string|ObjectId} blockerId
   * @param {Array<string|ObjectId>} blockedIds
   * @returns {Promise<boolean>}
   */
  async hasBlockedAny(blockerId, blockedIds) {
    return Boolean(await Block.exists({ blockerId, blockedId: { $in: blockedIds } }));
  }

  /**
   * Find all blocks a parent is involved in (as blocker or blocked)
   * @param {string|ObjectId} parentId
   * @returns {Promise<Array>}
   */
  async findBlocksInvolving(parentId) {
    return Block.find({
      $or: [{ blockerId: parentId }, { blockedId: parentId }],
    }).lean();
  }

  /**
   * Check whether a reporter already reported a parent since the given date
   * @param {string|ObjectId} reporterId
   * @param {string|ObjectId} reportedUserId
   * @param {Date} since
   * @returns {Promise<boolean>}
   */
  async hasRecentReport(reporterId, reportedUserId, since) {
    const report = await Report.exists({
      reporterId,
      reportedUserId,
      createdAt: { $gte: since },
    });
    return Boolean(report);
  }

  /**
   * Create a safety report
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async createReport(data) {
    return Report.create(data);
  }

  /**
   * Find paginated list of blocked parents by blocker
   * @param {string|ObjectId} blockerId
   * @param {{ page: number, limit: number, blockedIds?: Array<ObjectId> }} options - blockedIds limits the
   *   list to these parents (name search)
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findBlockedUsersByBlocker(blockerId, { page = 1, limit = 10, blockedIds } = {}) {
    const query = { blockerId };
    if (blockedIds) query.blockedId = { $in: blockedIds };
    const [items, total] = await Promise.all([
      Block.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({
          path: 'blockedId',
          select: 'fullName avatarUrl',
          // A deleted parent keeps its id so the block can still be listed and removed
          transform: (doc, id) => doc ?? { _id: id },
        })
        .lean(),
      Block.countDocuments(query),
    ]);
    return { items, total };
  }


  /**
   * Reports filed against a parent, in total and still open (pending / reviewing)
   * @param {string|ObjectId} reportedUserId - parents._id
   * @param {string[]} openStatuses
   * @returns {Promise<{ total: number, open: number }>}
   */
  async countReportsAgainst(reportedUserId, openStatuses) {
    const [total, open] = await Promise.all([
      Report.countDocuments({ reportedUserId }),
      Report.countDocuments({ reportedUserId, status: { $in: openStatuses } }),
    ]);
    return { total, open };
  }

  /**
   * Moderation queue page
   * @param {Object} options
   * @param {string} [options.status]
   * @param {string} [options.severity]
   * @param {string} [options.category]
   * @param {string} [options.targetType]
   * @param {Date} [options.from]
   * @param {Date} [options.to]
   * @param {string} [options.search] - Matched with the reason, literally
   * @param {Array<string|ObjectId>} [options.searchParentIds] - Reporter or reported parent, with search
   * @param {{ critical: Date, regular: Date }} [options.overdueBefore] - Only reports overdue at these cutoffs
   * @param {string} [options.sort] - One of REPORT_SORTS
   * @param {number} options.page
   * @param {number} options.limit
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findReportPage({
    status,
    statuses,
    severity,
    category,
    targetType,
    from,
    to,
    search,
    searchParentIds = [],
    overdueBefore,
    sort = REPORT_SORTS.QUEUE,
    page,
    limit,
  }) {
    const conditions = [];
    if (search) {
      const parentIds = searchParentIds.map(toObjectId);
      conditions.push({
        $or: [
          { reporterId: { $in: parentIds } },
          { reportedUserId: { $in: parentIds } },
          { reason: { $regex: escapeRegExp(search), $options: "i" } },
        ],
      });
    }
    if (overdueBefore) conditions.push(toOverdueFilter(overdueBefore));

    const match = {
      ...(status ? { status } : {}),
      ...(statuses && Array.isArray(statuses) && statuses.length > 0 ? { status: { $in: statuses } } : {}),
      ...(severity ? { severity } : {}),
      ...(category ? { category } : {}),
      ...(targetType ? { targetType } : {}),
      ...toCreatedAtFilter({ from, to }),
      ...(conditions.length > 0 ? { $and: conditions } : {}),
    };

    const [result] = await Report.aggregate([
      { $match: match },
      { $addFields: { severityWeight: SEVERITY_WEIGHT_FIELD } },
      { $sort: REPORT_SORT_STAGES[sort] || REPORT_SORT_STAGES[REPORT_SORTS.QUEUE] },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);
    return { items: result?.items || [], total: result?.totalCount?.[0]?.count || 0 };
  }

  /**
   * Moderation queue page by case: the reports about the same content are one row (see CASE_GROUP_FIELD).
   * Same options as findReportPage. Each item is the first report of the case that matches the filters,
   * with `caseSeverityWeight` and `caseCreatedAt` (the case is as severe as its worst report and as old
   * as its first one).
   * @returns {Promise<{ items: Array<Object>, total: number }>}
   */
  async findCasePage({
    status,
    severity,
    category,
    targetType,
    from,
    to,
    search,
    searchParentIds = [],
    overdueBefore,
    sort = REPORT_SORTS.QUEUE,
    page,
    limit,
  }) {
    const conditions = [];
    if (search) {
      const parentIds = searchParentIds.map(toObjectId);
      conditions.push({
        $or: [
          { reporterId: { $in: parentIds } },
          { reportedUserId: { $in: parentIds } },
          { reason: { $regex: escapeRegExp(search), $options: "i" } },
        ],
      });
    }
    if (overdueBefore) conditions.push(toOverdueFilter(overdueBefore));

    const match = {
      // An open case holds pending reports and, from before the single-step flow, reviewing ones
      ...(status ? { status: REPORT_OPEN_STATUSES.includes(status) ? { $in: REPORT_OPEN_STATUSES } : status } : {}),
      ...(severity ? { severity } : {}),
      ...(category ? { category } : {}),
      ...(targetType ? { targetType } : {}),
      ...toCreatedAtFilter({ from, to }),
      ...(conditions.length > 0 ? { $and: conditions } : {}),
    };

    const [result] = await Report.aggregate([
      { $match: match },
      { $addFields: { severityWeight: SEVERITY_WEIGHT_FIELD } },
      { $sort: { createdAt: 1, _id: 1 } },
      {
        $group: {
          _id: CASE_GROUP_FIELD,
          report: { $first: "$$ROOT" },
          severityWeight: { $max: "$severityWeight" },
          createdAt: { $min: "$createdAt" },
        },
      },
      { $sort: REPORT_SORT_STAGES[sort] || REPORT_SORT_STAGES[REPORT_SORTS.QUEUE] },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);
    return {
      items: (result?.items || []).map((row) => ({
        ...row.report,
        caseSeverityWeight: row.severityWeight,
        caseCreatedAt: row.createdAt,
      })),
      total: result?.totalCount?.[0]?.count || 0,
    };
  }

  /**
   * Every report of the case of a report, oldest first: the open reports about the same content while it
   * is open, the reports closed by the same decision once it is closed.
   * @param {Object} report
   * @returns {Promise<Array<Object>>}
   */
  async findCaseReports(report) {
    const isOpen = REPORT_OPEN_STATUSES.includes(report.status);
    if (!isOpen && !report.closedCaseId) return [report];
    const query = isOpen
      ? { ...toCaseFilter(report), status: { $in: REPORT_OPEN_STATUSES } }
      : { closedCaseId: report.closedCaseId };
    const reports = await Report.find(query).sort({ createdAt: 1, _id: 1 }).lean();
    return reports.length > 0 ? reports : [report];
  }

  /**
   * Queue counts of the stat strip, by case
   * @param {Object} options
   * @param {Date} [options.from]
   * @param {Date} [options.to]
   * @param {{ critical: Date, regular: Date }} options.overdueBefore
   * @param {Date} options.weekStart
   */
  async getReportStats({ from, to, overdueBefore, weekStart }) {
    const range = toCreatedAtFilter({ from, to });
    const [open, resolved, dismissed, bySeverity, overdue, criticalPending, resolvedThisWeek, averages] = await Promise.all([
      countCases({ ...range, status: { $in: REPORT_OPEN_STATUSES } }),
      countCases({ ...range, status: REPORT_STATUS.RESOLVED }),
      countCases({ ...range, status: REPORT_STATUS.DISMISSED }),
      countByField(range, "severity"),
      countCases({ ...range, ...toOverdueFilter(overdueBefore) }),
      countCases({ ...range, status: { $in: REPORT_OPEN_STATUSES }, severity: REPORT_SEVERITY.CRITICAL }),
      countCases({ ...range, status: REPORT_STATUS.RESOLVED, resolvedAt: { $gte: weekStart } }),
      Report.aggregate([
        { $match: { ...range, status: { $in: REPORT_CLOSED_STATUSES }, resolvedAt: { $ne: null } } },
        { $group: { _id: null, avgMs: { $avg: { $subtract: ["$resolvedAt", "$createdAt"] } } } },
      ]),
    ]);
    const byStatus = {
      [REPORT_STATUS.PENDING]: open,
      [REPORT_STATUS.RESOLVED]: resolved,
      [REPORT_STATUS.DISMISSED]: dismissed,
    };
    return { byStatus, bySeverity, overdue, criticalPending, resolvedThisWeek, avgResolutionMs: averages[0]?.avgMs || 0 };
  }

  /**
   * @returns {Promise<Object|null>} Plain report
   */
  async findReportById(id) {
    return Report.findById(id).lean();
  }

  /**
   * @returns {Promise<Document|null>} Report to change and save
   */
  async findReportDocById(id) {
    return Report.findById(id);
  }

  /**
   * Open reports with the given ids against a parent
   * @returns {Promise<Array<Document>>}
   */
  async findOpenReportDocsAgainst(reportedUserId, ids) {
    return Report.find({ _id: { $in: ids }, reportedUserId, status: { $in: REPORT_OPEN_STATUSES } });
  }

  /**
   * Every other report against a parent, newest first
   * @returns {Promise<Array<Object>>}
   */
  async findOtherReportsAgainst(reportedUserId, excludedReportId) {
    return Report.find({ reportedUserId, _id: { $ne: excludedReportId } })
      .select("category severity status resolution actions reporterId createdAt resolvedAt")
      .sort({ createdAt: -1 })
      .lean();
  }

  async countReportsFiledBy(reporterId) {
    return Report.countDocuments({ reporterId });
  }

  /**
   * Resolved reports with a sanction of their own against a user (the service counts strikes from them).
   * Excludes actions that were propagated from another report or are provisional.
   * @param {string|mongoose.Types.ObjectId} reportedUserId
   * @param {string|mongoose.Types.ObjectId} [excludeReportId]
   * @returns {Promise<Array<{ _id, targetMessageId, targetPlaydateId }>>}
   */
  async findPriorSanctionedReports(reportedUserId, excludeReportId = null) {
    const query = {
      reportedUserId,
      status: REPORT_STATUS.RESOLVED,
      actions: {
        $elemMatch: {
          propagatedFrom: null,
          isProvisional: { $ne: true },
        },
      },
    };
    if (excludeReportId) {
      query._id = { $ne: excludeReportId };
    }
    return Report.find(query).select('_id targetMessageId targetPlaydateId').lean();
  }

  /**
   * Find reports against a user within a specific time window
   * @param {string|mongoose.Types.ObjectId} reportedUserId
   * @param {Date} windowStart
   * @param {Date} windowEnd
   */
  async findReportsAgainstInWindow(reportedUserId, windowStart, windowEnd) {
    return Report.find({
      reportedUserId,
      createdAt: { $gte: windowStart, $lte: windowEnd },
    })
      .select('reporterId targetType targetMessageId targetPlaydateId category reason evidenceUrls createdAt')
      .lean();
  }

  /**
   * Find open reports against a user
   * @param {string|mongoose.Types.ObjectId} reportedUserId
   * @param {string[]} [openStatuses]
   */
  async findOpenReportsAgainst(reportedUserId, openStatuses = REPORT_OPEN_STATUSES) {
    return Report.find({
      reportedUserId,
      status: { $in: openStatuses },
    })
      .select('reporterId reportedUserId targetType targetMessageId targetPlaydateId category severity reason evidenceUrls createdAt')
      .lean();
  }

  /**
   * Latest sanction that suspended or banned a parent (provisional ones included), on the report it was
   * decided on (copies on reports closed with it are skipped), or null when no report did
   * @param {string|mongoose.Types.ObjectId} reportedUserId - parents._id
   * @param {string[]} lockTypes - Sanctions that lock the account
   * @returns {Promise<{ reportId: ObjectId, category: string, actionType: string, durationDays: number|null, performedAt: Date }|null>}
   */
  async findLatestLockAction(reportedUserId, lockTypes) {
    const [row] = await Report.aggregate([
      { $match: { reportedUserId: toObjectId(reportedUserId), "actions.type": { $in: lockTypes } } },
      { $unwind: "$actions" },
      { $match: { "actions.type": { $in: lockTypes }, "actions.propagatedFrom": null } },
      { $sort: { "actions.performedAt": -1 } },
      { $limit: 1 },
      { $project: { category: 1, status: 1, action: "$actions" } },
    ]);
    if (!row) return null;
    return {
      reportId: row._id,
      category: row.category,
      status: row.status,
      actionType: row.action.type,
      durationDays: row.action.params?.durationDays ?? null,
      performedAt: row.action.performedAt,
    };
  }

  /**
   * Add one entry to the log of a report, without loading and saving the whole report
   * @param {string|mongoose.Types.ObjectId} reportId
   * @param {Object} entry - A report history entry
   */
  async pushReportHistory(reportId, entry) {
    return Report.updateOne({ _id: reportId }, { $push: { history: entry } });
  }

  /**
   * Count report outcomes for a reporter
   * @param {string|mongoose.Types.ObjectId} reporterId
   */
  async countReporterOutcomes(reporterId) {
    const [totalSubmitted, confirmedCount, dismissedCount] = await Promise.all([
      Report.countDocuments({ reporterId }),
      Report.countDocuments({ reporterId, status: REPORT_STATUS.RESOLVED }),
      Report.countDocuments({ reporterId, status: REPORT_STATUS.DISMISSED }),
    ]);
    return {
      totalSubmitted,
      confirmedCount,
      dismissedCount,
    };
  }

  /**
   * Check if reported user currently has open reports with active temporary restriction
   * @param {string|mongoose.Types.ObjectId} reportedUserId
   */
  async hasOpenRestrictedReports(reportedUserId) {
    const count = await Report.countDocuments({
      reportedUserId,
      status: { $in: REPORT_OPEN_STATUSES },
      'sentinelAssessment.monitoring.temporaryRestriction.applied': true,
    });
    return count > 0;
  }

  async saveReport(report) {
    return report.save();
  }

  /**
   * Give a severity, from their category, to the reports that have none, and empty logs to those without
   * @returns {Promise<number>} Reports with a new severity
   */
  async backfillReportSeverities() {
    const validSeverities = Object.values(REPORT_SEVERITY);
    const options = { timestamps: false };
    const results = await Promise.all(
      Object.entries(CATEGORY_TO_SEVERITY).map(([category, severity]) =>
        Report.updateMany({ category, severity: { $nin: validSeverities } }, { $set: { severity } }, options)
      )
    );
    const rest = await Report.updateMany(
      { severity: { $nin: validSeverities } },
      { $set: { severity: REPORT_SEVERITY.MEDIUM } },
      options
    );
    await Report.updateMany({ actions: { $exists: false } }, { $set: { actions: [] } }, options);
    await Report.updateMany({ history: { $exists: false } }, { $set: { history: [] } }, options);
    return results.reduce((sum, result) => sum + result.modifiedCount, rest.modifiedCount);
  }
}

export const safetyRepository = new SafetyRepository();
export default safetyRepository;
