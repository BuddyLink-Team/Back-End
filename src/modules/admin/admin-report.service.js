import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import authService from '../auth/auth.service.js';
import playdateService from '../playdate/playdate.service.js';
import safetyService from '../safety/safety.service.js';
import sentinelService from '../safety/sentinel.service.js';
import sanctionExecutorService from '../safety/sanction-executor.service.js';
import { calculatePolicySanction, checkActionPolicyCompliance } from '../safety/moderation-policy.rules.js';
import { caseKeyOf } from '../safety/enforcement-metrics.rules.js';
import chatService from '../chat/chat.service.js';
import notificationService from '../notification/notification.service.js';
import { NOTIFICATION_TYPES } from '../notification/notification.constants.js';
import moderationRealtimeService from '../safety/moderation-realtime.service.js';
import logger from '../../shared/logger/index.js';
import env from '../../config/env.js';
import AppError from '../../shared/exceptions/app-error.js';
import { getZonedParts, getZonedDayRange } from '../../shared/helpers/date.helper.js';
import { ADMIN_REPORT_ERRORS, REPORT_DECISIONS } from './admin.constants.js';
import { emitUserEvent, USER_EVENTS } from '../user/user.events.js';
import {
  toOptionalBoolean,
  toPaging,
  toPagination,
  toDateBound,
} from './admin.helpers.js';
import {
  REPORT_ACCOUNT_SANCTION_TYPES,
  REPORT_ACTION_TYPES,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_NOTICES,
  REPORT_CLOSED_STATUSES,
  REPORT_HISTORY_EVENT_TYPES,
  REPORT_OPEN_STATUSES,
  REPORT_RESOLUTION_TYPES,
  REPORT_SANCTION_TYPES,
  REPORT_SEVERITY,
  REPORT_STATUS,
  REPORT_TARGET_TYPES,
  OVERDUE_THRESHOLDS_HOURS,
  REPORT_SEVERITY_WEIGHTS,
  SENTINEL_VERDICTS,
  toActionLabels,
} from '../safety/safety.constants.js';
import {
  AdminPlaydateDTO,
  AdminReportListItemDTO,
  AdminReportDetailDTO,
} from './admin.dto.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const checkIsOverdue = (report) => {
  if (!REPORT_OPEN_STATUSES.includes(report.status)) return false;
  const thresholdHours = OVERDUE_THRESHOLDS_HOURS[report.severity] || OVERDUE_THRESHOLDS_HOURS[REPORT_SEVERITY.MEDIUM];
  return Date.now() - new Date(report.createdAt).getTime() > thresholdHours * HOUR_MS;
};

const toOverdueCutoffs = () => ({
  critical: new Date(Date.now() - OVERDUE_THRESHOLDS_HOURS[REPORT_SEVERITY.CRITICAL] * HOUR_MS),
  regular: new Date(Date.now() - OVERDUE_THRESHOLDS_HOURS[REPORT_SEVERITY.MEDIUM] * HOUR_MS),
});

const getZonedWeekStart = () => {
  const { year, month, day } = getZonedParts(new Date());
  const monday = new Date(Date.UTC(year, month - 1, day));
  monday.setUTCDate(day - ((monday.getUTCDay() + 6) % 7));
  return getZonedDayRange(monday.toISOString().slice(0, 10)).start;
};

const formatNoticeDate = (date) => date.toLocaleString('vi-VN', { timeZone: env.APP_TIMEZONE });

class AdminReportService {
  /**
   * Moderation queue by case: the reports about the same content are one row, with how many parents
   * reported it. Severity then oldest first, unless another order is asked for.
   * @param {Object} queryParams
   */
  async getReports(queryParams) {
    const paging = toPaging(queryParams);
    const search = queryParams.search?.trim();
    // The Excel export lists every report on its own line (view=reports)
    const isByReport = queryParams.view === 'reports';
    const findPage = isByReport ? safetyService.findReportPage : safetyService.findCasePage;

    const { items: reports, total } = await findPage.call(safetyService, {
      status: queryParams.status,
      severity: queryParams.severity,
      category: queryParams.category,
      targetType: queryParams.targetType,
      from: toDateBound(queryParams.fromDate),
      to: toDateBound(queryParams.toDate, { endOfDay: true }),
      search,
      searchParentIds: search ? await this._findParentIdsBySearch(search) : [],
      overdueBefore: toOptionalBoolean(queryParams.isOverdue) ? toOverdueCutoffs() : undefined,
      sort: queryParams.sort,
      ...paging,
    });
    // Every report of each case, whatever the filters kept: the row counts all of its reporters
    const caseReports = isByReport
      ? []
      : await Promise.all(reports.map((report) => safetyService.getCaseReports(report)));
    return {
      items: await this._toReportListItems(reports, caseReports),
      pagination: toPagination(paging, total),
    };
  }

  /**
   * List items of reports, each with the reports of its case when given
   * @private
   * @param {Array<Object>} reports
   * @param {Array<Array<Object>>} [caseReports] - Reports of the case of each report, same order
   */
  async _toReportListItems(reports, caseReports = []) {
    const parentIds = [
      ...new Set(
        [...reports, ...caseReports.flat()].flatMap((report) => [String(report.reporterId), String(report.reportedUserId)])
      ),
    ];
    const parents = await parentService.getParentsByIds(parentIds);
    const [users, actorsById, messageContents] = await Promise.all([
      userService.getUsersByIds(parents.map((parent) => parent.userId).filter(Boolean)),
      this._getReportActors(reports),
      chatService.getMessageContents(reports.map((report) => report.targetMessageId).filter(Boolean)),
    ]);
    const parentById = new Map(parents.map((parent) => [String(parent._id), parent]));
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const toUser = (parent) => (parent ? userById.get(String(parent.userId)) : null);

    return reports.map((report, index) => {
      const reporterParent = parentById.get(String(report.reporterId));
      const reportedParent = parentById.get(String(report.reportedUserId));
      const members = caseReports[index] || [report];
      const reporterIds = [...new Set(members.map((member) => String(member.reporterId)))];
      // The case is as old as its first report and as severe as its worst one
      const first = members[0] || report;
      const worst = members.reduce(
        (found, member) =>
          (REPORT_SEVERITY_WEIGHTS[member.severity] || 0) > (REPORT_SEVERITY_WEIGHTS[found.severity] || 0) ? member : found,
        report
      );
      return AdminReportListItemDTO.toResponse({
        report,
        reporterParent,
        reporterUser: toUser(reporterParent),
        reportedParent,
        reportedUser: toUser(reportedParent),
        actorsById,
        isOverdue: members.some(checkIsOverdue),
        reportedMessageContent: report.targetMessageId
          ? messageContents.get(String(report.targetMessageId)) || null
          : null,
        caseSummary: {
          reportCount: members.length,
          reporterCount: reporterIds.length,
          reporterNames: reporterIds.map((id) => parentById.get(id)?.fullName).filter(Boolean),
          firstReportedAt: first.createdAt,
          severity: worst.severity,
        },
      });
    });
  }

  /**
   * Open reports one by one (not by case), with their Sentinel assessment: the scan overview groups them
   * by reported parent itself.
   * @private
   * @param {number} limit
   */
  async _listOpenReports(limit) {
    const { items } = await safetyService.findReportPage({ statuses: REPORT_OPEN_STATUSES, page: 1, limit });
    return this._toReportListItems(items);
  }

  /**
   * Queue counts of the stat strip and the status tabs
   * @param {{ fromDate?: string, toDate?: string }} queryParams
   */
  async getReportStats(queryParams = {}) {
    const { byStatus, bySeverity, overdue, criticalPending, resolvedThisWeek, avgResolutionMs } =
      await safetyService.getReportStats({
        from: toDateBound(queryParams.fromDate),
        to: toDateBound(queryParams.toDate, { endOfDay: true }),
        overdueBefore: toOverdueCutoffs(),
        weekStart: getZonedWeekStart(),
      });

    const countOf = (counts, value) => counts[value] || 0;
    const pending = countOf(byStatus, REPORT_STATUS.PENDING);
    const reviewing = countOf(byStatus, REPORT_STATUS.REVIEWING);
    const resolved = countOf(byStatus, REPORT_STATUS.RESOLVED);
    const dismissed = countOf(byStatus, REPORT_STATUS.DISMISSED);

    return {
      total: pending + reviewing + resolved + dismissed,
      pending,
      reviewing,
      resolved,
      dismissed,
      bySeverity: Object.fromEntries(
        Object.values(REPORT_SEVERITY).map((severity) => [severity, countOf(bySeverity, severity)])
      ),
      resolvedThisWeek,
      overdue,
      criticalPending,
      avgResolutionHours: Number((avgResolutionMs / HOUR_MS).toFixed(1)),
    };
  }

  /**
   * Full investigation detail of a report
   * @param {string} id
   */
  async getReportDetail(id) {
    const report = await safetyService.getReportById(id);
    if (!report) {
      throw new AppError('Report not found', 404, ADMIN_REPORT_ERRORS.REPORT_NOT_FOUND);
    }

    const [reporterParent, reportedParent, totalReportsSubmitted, otherReports] = await Promise.all([
      parentService.getParentById(report.reporterId),
      parentService.getParentById(report.reportedUserId),
      safetyService.countReportsFiledBy(report.reporterId),
      safetyService.getOtherReportsAgainst(report.reportedUserId, report._id),
    ]);

    const [users, actorsById, targetContext, relatedReporters] = await Promise.all([
      userService.getUsersByIds([reporterParent?.userId, reportedParent?.userId].filter(Boolean)),
      this._getReportActors([report]),
      this._getReportTargetContext(report),
      parentService.getParentsByIds([...new Set(otherReports.map((other) => String(other.reporterId)))]),
    ]);
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const reporterNameById = new Map(relatedReporters.map((parent) => [String(parent._id), parent.fullName]));

    const relatedOpenReports = otherReports
      .filter((other) => REPORT_OPEN_STATUSES.includes(other.status))
      .map((other) => ({
        id: other._id.toString(),
        category: other.category,
        severity: other.severity,
        createdAt: other.createdAt,
        reporterName: reporterNameById.get(String(other.reporterId)) || 'Người dùng BuddyLink',
      }));

    const pastReports = otherReports.map((other) => ({
      id: other._id.toString(),
      category: other.category,
      severity: other.severity,
      status: other.status,
      resolution: other.resolution || null,
      createdAt: other.createdAt,
      resolvedAt: other.resolvedAt || null,
    }));

    const previousSanctions = otherReports
      .flatMap((other) =>
        (other.actions || []).map((action) => ({
          reportId: other._id.toString(),
          type: action.type,
          params: action.params || {},
          performedAt: action.performedAt,
          note: action.note || '',
        }))
      )
      .sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt));

    // An open report shows the rules applied to the data of now (new reports, strikes, severity):
    // the AI text stays from its assessment, the numbers and the recommendation are recomputed.
    // A closed report keeps what was decided.
    const isOpen = REPORT_OPEN_STATUSES.includes(report.status);
    const ruleSnapshot = isOpen
      ? await sentinelService.buildRuleSnapshot(report).catch((err) => {
          logger.warn(`[AdminReport] Rule snapshot failed for report=${id}: ${err.message}`);
          return null;
        })
      : null;

    // The matrix is always shown (the decision dialog preselects its sanctions); leaving it only needs a
    // policy override once the AI assessed the report
    const priorViolationCount = await safetyService.countUserPriorSanctions(report.reportedUserId, report);
    const policyGuidance =
      ruleSnapshot?.policyResult ||
      calculatePolicySanction(report.category, report.severity, priorViolationCount, report.targetType);

    // The case: every report about the same content, decided together
    const members = await safetyService.getCaseReports(report);
    const memberParents = await parentService.getParentsByIds([...new Set(members.map((member) => String(member.reporterId)))]);
    const memberUsers = await userService.getUsersByIds(memberParents.map((parent) => parent.userId).filter(Boolean));
    const memberParentById = new Map(memberParents.map((parent) => [String(parent._id), parent]));
    const memberUserById = new Map(memberUsers.map((user) => [String(user._id), user]));
    const caseReports = members.map((member) => {
      const parent = memberParentById.get(String(member.reporterId));
      return AdminReportDetailDTO.toCaseReport({
        report: member,
        reporterParent: parent,
        reporterUser: parent ? memberUserById.get(String(parent.userId)) : null,
      });
    });

    // Other open cases against the same parent, by case
    const ownCaseKey = isOpen ? caseKeyOf(report) : null;
    const openAgainst = await safetyService.findOpenReportsAgainst(report.reportedUserId);
    const otherCases = new Map();
    openAgainst
      .filter((other) => caseKeyOf(other) !== ownCaseKey)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .forEach((other) => {
        const key = caseKeyOf(other);
        const found = otherCases.get(key);
        if (!found) {
          otherCases.set(key, {
            id: other._id.toString(),
            targetType: other.targetType,
            category: other.category,
            severity: other.severity,
            createdAt: other.createdAt,
            reportCount: 1,
            reporterIds: new Set([String(other.reporterId)]),
          });
          return;
        }
        found.reportCount += 1;
        found.reporterIds.add(String(other.reporterId));
        if ((REPORT_SEVERITY_WEIGHTS[other.severity] || 0) > (REPORT_SEVERITY_WEIGHTS[found.severity] || 0)) {
          found.severity = other.severity;
        }
      });
    const otherOpenCases = [...otherCases.values()].map(({ reporterIds, ...item }) => ({
      ...item,
      reporterCount: reporterIds.size,
    }));
    const reportView = ruleSnapshot
      ? {
          ...report,
          sentinelAssessment: {
            ...report.sentinelAssessment,
            ...ruleSnapshot.ruleFields,
            newReportsSinceAssessment: ruleSnapshot.newReportsSinceAssessment,
          },
        }
      : report;

    return AdminReportDetailDTO.toResponse({
      report: reportView,
      reporterParent,
      reporterUser: userById.get(String(reporterParent?.userId)),
      reportedParent,
      reportedUser: userById.get(String(reportedParent?.userId)),
      actorsById,
      targetContext,
      relatedOpenReports,
      pastReports,
      previousSanctions,
      policyGuidance,
      isPolicyEnforced: Boolean(report.sentinelAssessment?.assessedAt),
      isOverdue: members.some(checkIsOverdue),
      totalReportsSubmitted,
      caseReports,
      otherOpenCases,
      priorViolationCount,
    });
  }

  /**
   * Bring the stored rule numbers of the user's open reports up to date (strikes, corroboration,
   * recommendation) after a change, so lists and overviews never show stale ones. Never fails the action.
   * @private
   */
  async _refreshRuleSnapshots(reportedUserId) {
    try {
      await sentinelService.refreshRuleSnapshots(reportedUserId);
    } catch (err) {
      logger.warn(`[AdminReport] Rule snapshots refresh failed for user=${reportedUserId}: ${err.message}`);
    }
  }

  /**
   * Update report severity during review
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ severity: string, note?: string }} param2
   */
  async updateReportSeverity(adminUserId, id, { severity, note }) {
    const report = await this._getReportDocOrFail(id);

    if (!REPORT_OPEN_STATUSES.includes(report.status)) {
      throw new AppError('Can only change the severity of an open report', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
    }

    const oldSeverity = report.severity;
    report.severity = severity;
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.SEVERITY_CHANGE,
      fromStatus: report.status,
      toStatus: report.status,
      by: adminUserId,
      at: new Date(),
      note: note || `Đổi mức độ nghiêm trọng từ ${oldSeverity} sang ${severity}`,
      metadata: { oldSeverity, newSeverity: severity },
    });

    await safetyService.saveReport(report);
    await this._refreshRuleSnapshots(report.reportedUserId);
    return this.getReportDetail(id);
  }

  /**
   * Apply a sanction, through the service of the module that owns its target
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ type: string, durationDays?: number, note?: string, isPolicyOverride?: boolean, overrideReason?: string }} param2
   */
  async applyReportAction(adminUserId, id, options, { isSilent = false } = {}) {
    const report = await this._executeReportAction(adminUserId, id, { ...options, isSilent });
    await this._refreshRuleSnapshots(report.reportedUserId);
    return this.getReportDetail(id);
  }

  /**
   * Run one sanction on an open report and record it (action, history). The report stays open.
   * @private
   * @returns {Promise<Document>} The saved report
   */
  async _executeReportAction(
    adminUserId,
    id,
    { type, durationDays, note, isPolicyOverride = false, overrideReason = '', isSilent = false }
  ) {
    const report = await this._getReportDocOrFail(id);

    if (REPORT_CLOSED_STATUSES.includes(report.status)) {
      throw new AppError('Cannot apply action on closed report', 409, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }
    if (!REPORT_SANCTION_TYPES.includes(type)) {
      throw new AppError('This action cannot be applied as a sanction', 400, ADMIN_REPORT_ERRORS.INVALID_ACTION_TYPE);
    }
    if ((report.actions || []).some((action) => action.type === type)) {
      throw new AppError('This action has already been applied to this report', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }

    this._assertActionTarget(report, type);

    const hasAssessment = Boolean(report.sentinelAssessment?.assessedAt);
    const priorCount = await safetyService.countUserPriorSanctions(report.reportedUserId, report);
    const policyResult = hasAssessment
      ? calculatePolicySanction(report.category, report.severity, priorCount, report.targetType)
      : null;
    const { isOverride: requiredOverride } = checkActionPolicyCompliance(type, policyResult, durationDays);

    if (requiredOverride && !isPolicyOverride) {
      throw new AppError(
        `Chế tài "${toActionLabels([type])}" không nằm trong khung quy chuẩn cho vi phạm này. Cần tích chọn "Áp dụng ngoại lệ chính sách" và giải trình lý do (ít nhất 20 ký tự).`,
        400,
        'POLICY_OVERRIDE_REQUIRED'
      );
    }

    if (isPolicyOverride && (!overrideReason || overrideReason.trim().length < 20)) {
      throw new AppError(
        'Vui lòng nhập lý do giải trình ngoại lệ chính sách (tối thiểu 20 ký tự).',
        400,
        'OVERRIDE_REASON_REQUIRED'
      );
    }

    const reportedParent = await parentService.getParentById(report.reportedUserId);
    if (!reportedParent) {
      throw new AppError('Reported parent not found', 404, ADMIN_REPORT_ERRORS.REPORTED_USER_NOT_FOUND);
    }
    const targetUser = await userService.liftExpiredSuspension(await userService.getUserById(reportedParent.userId));

    const sanctions = {
      [REPORT_ACTION_TYPES.WARN]: () => this._warnReportedUser(report, targetUser, isSilent),
      [REPORT_ACTION_TYPES.DELETE_MESSAGE]: () => this._deleteReportedMessage(report, targetUser, isSilent),
      [REPORT_ACTION_TYPES.CANCEL_PLAYDATE]: () => this._cancelReportedPlaydate(report, note),
      [REPORT_ACTION_TYPES.SUSPEND]: () => this._suspendReportedUser(report, targetUser, durationDays, isSilent),
      [REPORT_ACTION_TYPES.BAN]: () => this._banReportedUser(report, targetUser, note, isSilent),
    };
    await sanctions[type]();

    const durationValue = type === REPORT_ACTION_TYPES.SUSPEND ? parseInt(durationDays, 10) : null;
    report.actions.push({
      type,
      params: { durationDays: durationValue, reason: note || '' },
      performedBy: adminUserId,
      actorType: 'admin',
      performedAt: new Date(),
      note: note || '',
      isPolicyOverride: Boolean(isPolicyOverride),
      overrideReason: isPolicyOverride ? overrideReason.trim() : '',
      policyClause: policyResult?.clause || '',
    });
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.ACTION_APPLIED,
      fromStatus: report.status,
      toStatus: report.status,
      by: adminUserId,
      actorType: 'admin',
      at: new Date(),
      note: isPolicyOverride
        ? `Đã thi hành chế tài (ngoại lệ chính sách): ${toActionLabels([type])} — Lý do: ${overrideReason}`
        : `Đã thi hành chế tài theo quy chuẩn: ${toActionLabels([type])}`,
      metadata: { actionType: type, durationDays: durationValue, isPolicyOverride, overrideReason },
    });

    if (isPolicyOverride) {
      report.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.POLICY_OVERRIDDEN,
        fromStatus: report.status,
        toStatus: report.status,
        by: adminUserId,
        actorType: 'admin',
        at: new Date(),
        note: `Ngoại lệ chính sách cho "${toActionLabels([type])}": ${overrideReason}`,
        metadata: { actionType: type, overrideReason },
      });
    }

    await safetyService.saveReport(report);
    return report;
  }

  _assertActionTarget(report, type) {
    if (type === REPORT_ACTION_TYPES.DELETE_MESSAGE) {
      if (report.targetType !== REPORT_TARGET_TYPES.MESSAGE) {
        throw new AppError('Report is not targeting a message', 400, ADMIN_REPORT_ERRORS.INVALID_ACTION_TYPE);
      }
      if (!report.targetMessageId) {
        throw new AppError('The reported message no longer exists', 404, ADMIN_REPORT_ERRORS.TARGET_NOT_FOUND);
      }
    }
    if (type === REPORT_ACTION_TYPES.CANCEL_PLAYDATE) {
      if (report.targetType !== REPORT_TARGET_TYPES.PLAYDATE) {
        throw new AppError('Report is not targeting a playdate', 400, ADMIN_REPORT_ERRORS.INVALID_ACTION_TYPE);
      }
      if (!report.targetPlaydateId) {
        throw new AppError('The reported playdate no longer exists', 404, ADMIN_REPORT_ERRORS.TARGET_NOT_FOUND);
      }
    }
  }

  /**
   * Run Sentinel AI Assessment on report
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ forceRefresh?: boolean }} param2
   */
  async assessReportWithSentinel(adminUserId, id, { forceRefresh = false } = {}) {
    const report = await this._getReportDocOrFail(id);
    const assessedReport = await sentinelService.assessReport(report, adminUserId, { forceRefresh });
    return this.getReportDetail(assessedReport._id.toString());
  }

  /**
   * Apply the recommended sanctions still missing (recommendation of now). Never closes the report:
   * the admin concludes it from the drawer, with notes and related reports.
   * Every sanction is checked first: if one cannot run, none runs. A sanction with nothing to act on
   * (cancelling a playdate already held) is skipped as not applicable, not as a failure.
   * If a recommended sanction fails, an ACTION_FAILED entry is added to the history.
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ note?: string }} [options] - Admin's approval note, kept in the audit log
   * @returns {Promise<Object>} Report detail, with `sentinelApplyResult: { applied, failed, notApplicable }`
   */
  async applySentinelRecommendation(adminUserId, id, { note = '' } = {}, { useDraftNotice = false } = {}) {
    const report = await this._getReportDocOrFail(id);

    if (REPORT_CLOSED_STATUSES.includes(report.status)) {
      throw new AppError('Cannot apply recommendation on a closed report', 409, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }

    let currentReport = report;
    if (!currentReport.sentinelAssessment?.assessedAt) {
      currentReport = await sentinelService.assessReport(currentReport, adminUserId);
    }

    const assessment = currentReport.sentinelAssessment;
    if (!assessment) {
      throw new AppError('No Sentinel assessment available for this report', 400, 'NO_SENTINEL_ASSESSMENT');
    }

    if (assessment.severityRecommendation && currentReport.severity !== assessment.severityRecommendation) {
      const oldSeverity = currentReport.severity;
      currentReport.severity = assessment.severityRecommendation;
      currentReport.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.SEVERITY_CHANGE,
        fromStatus: currentReport.status,
        toStatus: currentReport.status,
        by: adminUserId,
        at: new Date(),
        note: `Đồng bộ mức độ theo đề xuất Sentinel: ${assessment.severityRecommendation}`,
        metadata: { oldSeverity, newSeverity: assessment.severityRecommendation },
      });
    }

    await safetyService.saveReport(currentReport);

    const approvalNote = (note || '').trim();
    // Recommendation of now (current severity and strikes), never the one stored at assessment time
    const liveSnapshot = await sentinelService.buildRuleSnapshot(currentReport).catch(() => null);
    // AI recommendation of now: none when the AI concluded there is no violation (or could not conclude)
    const recommended = liveSnapshot?.ruleFields?.recommendedSanctions ?? assessment.recommendedSanctions ?? [];
    const policyClause = liveSnapshot?.policyResult?.clause || assessment.policyClause;
    const pending = recommended.filter(
      (sanction) =>
        REPORT_SANCTION_TYPES.includes(sanction.type) &&
        !(currentReport.actions || []).some((a) => a.type === sanction.type)
    );

    // Check every sanction first: a sanction that cannot run blocks them all (no half-applied report),
    // one with nothing to act on (a playdate already held) is skipped as not applicable
    const reportedParent = await parentService.getParentById(currentReport.reportedUserId).catch(() => null);
    const targetUser = reportedParent?.userId
      ? await userService.getUserById(reportedParent.userId).catch(() => null)
      : null;
    const plan = await sanctionExecutorService.planSanctions({
      report: currentReport,
      targetUser,
      actions: pending,
    });

    const appliedTypes = [];
    const offenderNotice = useDraftNotice ? (assessment.draftNotes?.reportedUserNotice || '').trim() : '';
    const failed = plan.blockers.map((b) => ({
      type: b.type,
      code: b.code,
      message: 'Không tìm thấy tài khoản bị báo cáo',
    }));
    const notApplicable = plan.notApplicable;

    if (failed.length === 0) {
      for (const sanction of plan.executable) {
        try {
          await this.applyReportAction(
            adminUserId,
            id,
            {
              type: sanction.type,
              durationDays: sanction.durationDays,
              note:
                approvalNote ||
                sanction.reason ||
                assessment.draftNotes?.adminNote ||
                `Thi hành theo đề xuất Sentinel (${policyClause})`,
              isPolicyOverride: false,
            },
            { isSilent: Boolean(offenderNotice) }
          );
          appliedTypes.push(sanction.type);
        } catch (err) {
          if (err.code !== ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED) {
            failed.push({ type: sanction.type, code: err.code || 'INTERNAL_ERROR', message: err.message });
          }
        }
      }
    }

    if (failed.length > 0) {
      // Reload: applyReportAction saved newer versions of the report
      const freshDoc = await this._getReportDocOrFail(id);
      freshDoc.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.ACTION_FAILED,
        fromStatus: freshDoc.status,
        toStatus: freshDoc.status,
        by: adminUserId,
        actorType: 'admin',
        at: new Date(),
        note: `Không thể thi hành đủ chế tài theo đề xuất Sentinel (${toActionLabels(
          failed.map((f) => f.type)
        )}) — báo cáo vẫn mở để Admin xử lý tiếp`,
        metadata: { appliedActions: appliedTypes, failedActions: failed, notApplicable },
      });
      await safetyService.saveReport(freshDoc);
      const detail = await this.getReportDetail(id);
      return { ...detail, sentinelApplyResult: { applied: appliedTypes, failed, notApplicable } };
    }

    if (offenderNotice && appliedTypes.length > 0) {
      await this._sendOffenderNotice(currentReport.reportedUserId, offenderNotice, currentReport._id);
    }

    // The report stays open: the admin concludes it (notes, related reports) from the drawer
    await this._refreshRuleSnapshots(currentReport.reportedUserId);
    const detail = await this.getReportDetail(id);
    return { ...detail, sentinelApplyResult: { applied: appliedTypes, failed, notApplicable } };
  }

  /**
   * Batch scan open reports in the moderation queue using BuddyLink Sentinel AI
   * and return a comprehensive overview of all scanned open reports.
   * @param {string} adminUserId
   */
  async batchScanReportsWithSentinel(adminUserId) {
    const { items, total } = await safetyService.findReportPage({
      statuses: REPORT_OPEN_STATUSES,
      page: 1,
      limit: 20,
    });

    const targets = items;

    const failedIds = [];
    const assessOne = async (item) => {
      const doc = await safetyService.getReportDocById(item._id);
      if (!doc) return null;
      return sentinelService.assessReport(doc, adminUserId, {
        forceRefresh: false,
        allowAutoEnforce: false,
      });
    };

    const results = [];
    for (let i = 0; i < targets.length; i += 3) {
      const chunk = targets.slice(i, i + 3);
      const settled = await Promise.allSettled(chunk.map((item) => assessOne(item)));
      settled.forEach((res, idx) => {
        if (res.status === 'fulfilled' && res.value) {
          results.push(res.value);
        } else {
          failedIds.push(chunk[idx]._id.toString());
        }
      });
    }

    let scannedCount = 0;
    let highConfidenceCount = 0;
    let autoShieldCount = 0;
    let autoResolvedCount = 0;

    for (const assessed of results) {
      if (!assessed) continue;
      scannedCount += 1;
      if ((assessed.sentinelAssessment?.confidenceScore || 0) >= 80) {
        highConfidenceCount += 1;
      }
      if (assessed.sentinelAssessment?.autoShieldApplied) {
        autoShieldCount += 1;
      }
      if (assessed.status === REPORT_STATUS.RESOLVED || assessed.sentinelAssessment?.autoResolved) {
        autoResolvedCount += 1;
      }
    }

    const refreshedItems = await this._listOpenReports(20);

    return {
      scannedCount,
      highConfidenceCount,
      autoShieldCount,
      autoResolvedCount,
      totalOpenCount: total,
      failedIds,
      scannedAt: new Date().toISOString(),
      scannedReports: refreshedItems,
    };
  }

  /**
   * Quick handling of a cluster (open reports against one parent) from the Sentinel overview,
   * following the same rules as the drawer:
   * - the AI found a violation: the recommended sanctions are applied ONCE, on the most severe report,
   *   which is resolved; the other violation reports of the cluster are closed with it as the same case
   *   (they get its warning / suspension / ban as propagated actions, never counted as extra strikes)
   * - the AI found no violation: the report is dismissed, unless a sanction was already applied to it
   * - left open for the admin: no assessment, an unclear verdict, child safety or critical,
   *   a ban or a suspension over 7 days, or a sanction that failed
   * @param {string} adminUserId
   * @param {{ reportIds: string[], note?: string }} payload
   * @returns {Promise<{ sanctionedReportId: string|null, applied: string[], resolved: string[], dismissed: string[], skipped: Array<{ id: string, reason: string }>, failed: Array<Object> }>}
   */
  async resolveSentinelCluster(adminUserId, { reportIds = [], note = '' } = {}) {
    const approvalNote = (note || '').trim();
    const docs = (await Promise.all([...new Set(reportIds)].map((id) => safetyService.getReportDocById(id)))).filter(
      (doc) => doc && REPORT_OPEN_STATUSES.includes(doc.status)
    );
    if (docs.length === 0) {
      throw new AppError('No open report in this cluster', 400, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }
    const reportedUserId = String(docs[0].reportedUserId);
    if (docs.some((doc) => String(doc.reportedUserId) !== reportedUserId)) {
      throw new AppError('A cluster only holds reports against one parent', 400, ADMIN_REPORT_ERRORS.CLUSTER_MIXED_USERS);
    }

    const result = { sanctionedReportId: null, applied: [], resolved: [], dismissed: [], skipped: [], failed: [] };
    const skip = (doc, reason) => result.skipped.push({ id: doc._id.toString(), reason });

    const violations = [];
    const noViolations = [];
    for (const doc of docs) {
      const verdict = doc.sentinelAssessment?.assessedAt ? doc.sentinelAssessment.verdict : null;
      if (!doc.sentinelAssessment?.assessedAt) {
        skip(doc, 'Chưa có phân tích AI');
      } else if (verdict === SENTINEL_VERDICTS.NO_VIOLATION) {
        noViolations.push(doc);
      } else if (verdict !== SENTINEL_VERDICTS.VIOLATION) {
        skip(doc, 'AI chưa đủ căn cứ kết luận — cần Admin xem xét');
      } else if (doc.category === REPORT_CATEGORIES.CHILD_SAFETY || doc.severity === REPORT_SEVERITY.CRITICAL) {
        skip(doc, 'An toàn trẻ em hoặc mức nghiêm trọng — bắt buộc Admin xử lý trong chi tiết');
      } else {
        violations.push(doc);
      }
    }

    if (violations.length > 0) {
      // The most severe report carries the sanctions, the oldest one first on a tie
      const [primary, ...others] = [...violations].sort(
        (a, b) =>
          (REPORT_SEVERITY_WEIGHTS[b.severity] || 0) - (REPORT_SEVERITY_WEIGHTS[a.severity] || 0) ||
          new Date(a.createdAt) - new Date(b.createdAt)
      );
      const primaryId = primary._id.toString();
      const snapshot = await sentinelService.buildRuleSnapshot(primary).catch(() => null);
      const recommended = snapshot?.ruleFields?.recommendedSanctions || [];
      const isHeavy = recommended.some(
        (s) => s.type === REPORT_ACTION_TYPES.BAN || (s.type === REPORT_ACTION_TYPES.SUSPEND && (s.durationDays || 0) > 7)
      );

      if (isHeavy) {
        violations.forEach((doc) => skip(doc, 'Đề xuất khóa tài khoản hoặc đình chỉ trên 7 ngày — cần Admin xác nhận trong chi tiết'));
      } else {
        const applyResult = await this.applySentinelRecommendation(
          adminUserId,
          primaryId,
          { note: approvalNote },
          { useDraftNotice: true }
        );
        const { applied = [], failed = [] } = applyResult.sentinelApplyResult || {};
        result.applied = applied;
        if (failed.length > 0) {
          result.failed.push({ id: primaryId, actions: failed });
          others.forEach((doc) => skip(doc, 'Chế tài của cụm chưa thi hành được — xử lý cùng báo cáo chính'));
        } else {
          const primaryDoc = await this._getReportDocOrFail(primaryId);
          const officialActions = (primaryDoc.actions || []).filter((action) => !action.isProvisional);
          const notes =
            approvalNote ||
            primaryDoc.sentinelAssessment?.draftNotes?.adminNote ||
            'Xử lý nhanh cụm báo cáo theo đề xuất của Sentinel AI.';
          const reporterNotice = primaryDoc.sentinelAssessment?.draftNotes?.reporterFeedback || '';
          await this.resolveReport(
            adminUserId,
            primaryId,
            {
              status: REPORT_STATUS.RESOLVED,
              resolution: officialActions.length > 0 ? REPORT_RESOLUTION_TYPES.ACTION_TAKEN : REPORT_RESOLUTION_TYPES.NO_ACTION,
              adminNotes: notes,
            },
            { reporterNotice }
          );
          result.sanctionedReportId = primaryId;
          result.resolved.push(primaryId);

          // Reports about the same content share a row of the queue
          const caseIds = new Map([[caseKeyOf(primaryDoc), primaryDoc._id]]);
          for (const other of others) {
            const key = caseKeyOf(other);
            if (!caseIds.has(key)) caseIds.set(key, other._id);
            const closed = await this._closeAsSameCase(
              adminUserId,
              other._id,
              primaryDoc,
              officialActions,
              notes,
              caseIds.get(key),
              reporterNotice
            );
            if (closed) result.resolved.push(other._id.toString());
            else skip(other, 'Báo cáo đã có chế tài riêng — cần Admin kết luận trong chi tiết');
          }
        }
      }
    }

    const dismissedCaseIds = new Map();
    for (const doc of noViolations) {
      if ((doc.actions || []).some((action) => !action.isProvisional)) {
        skip(doc, 'AI kết luận không vi phạm nhưng báo cáo đã có chế tài — cần Admin kết luận');
        continue;
      }
      try {
        const key = caseKeyOf(doc);
        if (!dismissedCaseIds.has(key)) dismissedCaseIds.set(key, doc._id);
        await this.resolveReport(
          adminUserId,
          doc._id.toString(),
          {
            status: REPORT_STATUS.DISMISSED,
            resolution: REPORT_RESOLUTION_TYPES.DISMISSED,
            adminNotes:
              approvalNote ||
              doc.sentinelAssessment?.draftNotes?.adminNote ||
              'Bác bỏ theo kết luận của Sentinel AI: không có vi phạm.',
          },
          {
            closedCaseId: dismissedCaseIds.get(key),
            reporterNotice: doc.sentinelAssessment?.draftNotes?.reporterFeedback || '',
          }
        );
        result.dismissed.push(doc._id.toString());
      } catch (err) {
        result.failed.push({ id: doc._id.toString(), code: err.code || 'INTERNAL_ERROR' });
      }
    }

    await this._liftRestrictionIfNoneLeft(reportedUserId);
    await this._refreshRuleSnapshots(reportedUserId);
    return result;
  }

  /**
   * Close a violation report of a cluster with the report that carried its sanctions: it gets the
   * warning / suspension / ban as propagated actions (no new strike, nothing executed again).
   * Sanctions tied to one target (a message, a playdate) stay on the report they belong to.
   * A report that already has its own sanction is left to the admin.
   * @private
   * @returns {Promise<boolean>} Whether the report was closed
   */
  async _closeAsSameCase(adminUserId, reportId, sourceDoc, sourceActions, notes, closedCaseId = null, reporterNotice = '') {
    const report = await this._getReportDocOrFail(reportId);
    if (!REPORT_OPEN_STATUSES.includes(report.status)) return false;
    if ((report.actions || []).some((action) => !action.isProvisional)) return false;

    const fromStatus = report.status;
    const shared = sourceActions.filter((action) =>
      [REPORT_ACTION_TYPES.WARN, ...REPORT_ACCOUNT_SANCTION_TYPES].includes(action.type)
    );
    const now = new Date();
    shared.forEach((action) => {
      report.actions.push({
        type: action.type,
        params: action.params,
        performedBy: adminUserId,
        actorType: 'admin',
        propagatedFrom: sourceDoc._id,
        performedAt: now,
        note: action.note,
        policyClause: action.policyClause || '',
      });
    });
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.ACTION_APPLIED,
      fromStatus,
      toStatus: fromStatus,
      by: adminUserId,
      actorType: 'admin',
      at: now,
      note: shared.length > 0
        ? `Xử lý chung với báo cáo chính của cụm: ${toActionLabels(shared.map((a) => a.type))}`
        : `Xử lý chung với báo cáo chính của cụm`,
      metadata: { sourceReportId: sourceDoc._id },
    });
    this._closeReport(report, {
      adminUserId,
      status: REPORT_STATUS.RESOLVED,
      resolution: shared.length > 0 ? REPORT_RESOLUTION_TYPES.ACTION_TAKEN : REPORT_RESOLUTION_TYPES.NO_ACTION,
      adminNotes: notes,
      historyNote: `Đóng cùng báo cáo chính của cụm: ${notes}`,
      historyMetadata: { sourceReportId: sourceDoc._id },
      closedCaseId,
    });
    await safetyService.saveReport(report);
    await this._notifyReporter(report, REPORT_STATUS.RESOLVED, reporterNotice);
    return true;
  }

  /**
   * Lift the messaging restriction of a parent once none of the open reports against them keeps it
   * @private
   */
  async _liftRestrictionIfNoneLeft(reportedUserId) {
    const hasRemainingRestricted = await safetyService.hasOpenRestrictedReports(reportedUserId);
    if (hasRemainingRestricted) return;
    const reportedParent = await parentService.getParentById(reportedUserId).catch(() => null);
    if (reportedParent?.userId) {
      await userService.liftMessagingRestriction(reportedParent.userId).catch(() => {});
    }
  }

  /**
   * Batch execute & auto-resolve all open reports that meet the AI confidence threshold
   * @param {string} adminUserId
   * @param {{ minConfidence?: number }} [options]
   */
  async batchApplySentinelRecommendations(adminUserId, { minConfidence = 80 } = {}) {
    const threshold = Math.max(75, Math.min(100, parseInt(minConfidence, 10) || 80));
    const { items } = await safetyService.findReportPage({
      statuses: REPORT_OPEN_STATUSES,
      page: 1,
      limit: 50,
    });

    let executedCount = 0;
    const processedIds = [];
    const skipped = [];
    const failed = [];

    for (const candidate of items) {
      const freshDoc = await safetyService.getReportDocById(candidate._id);
      if (!freshDoc || REPORT_CLOSED_STATUSES.includes(freshDoc.status)) {
        continue;
      }

      if (!freshDoc.sentinelAssessment?.assessedAt) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Chưa có đánh giá từ Sentinel AI' });
        continue;
      }
      // Eligibility and recommendation of now: new reports or strikes since the assessment count
      const liveSnapshot = await sentinelService.buildRuleSnapshot(freshDoc).catch(() => null);
      const assessment = {
        ...freshDoc.sentinelAssessment.toObject(),
        ...(liveSnapshot?.ruleFields || {}),
      };
      if ((assessment.confidenceScore || 0) < threshold) {
        skipped.push({ id: freshDoc._id.toString(), reason: `Độ tự tin (${assessment.confidenceScore}%) thấp hơn ngưỡng ${threshold}%` });
        continue;
      }
      if (assessment.isFallback) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Đánh giá AI gặp sự cố (Fallback) — Cần Admin xử lý thủ công' });
        continue;
      }
      if (assessment.autoResolveEligible !== true) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Không đủ điều kiện tự động thi hành (cần Human-in-the-Loop)' });
        continue;
      }
      if (assessment.monitoring?.reporterCredibility?.coordinatedSuspected) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Nghi vấn báo cáo phối hợp/brigading' });
        continue;
      }
      if (freshDoc.category === REPORT_CATEGORIES.CHILD_SAFETY || freshDoc.severity === REPORT_SEVERITY.CRITICAL) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Vi phạm an toàn trẻ em hoặc mức Critical bắt buộc Admin xác nhận' });
        continue;
      }

      const hasHeavySanction = (assessment.recommendedSanctions || []).some(
        (s) => s.type === REPORT_ACTION_TYPES.BAN || (s.type === REPORT_ACTION_TYPES.SUSPEND && (s.durationDays || 0) > 7)
      );
      if (hasHeavySanction) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Đề xuất chế tài nặng (Cấm hoặc đình chỉ > 7 ngày)' });
        continue;
      }

      const reportId = freshDoc._id.toString();
      try {
        const result = await this.applySentinelRecommendation(adminUserId, reportId);
        if (result.sentinelApplyResult?.failed?.length) {
          failed.push({ id: reportId, code: 'ACTION_FAILED', actions: result.sentinelApplyResult.failed });
          continue;
        }
        // Batch apply concludes each report itself: this one only, the others are taken one by one
        const appliedDoc = await this._getReportDocOrFail(reportId);
        await this.resolveReport(adminUserId, reportId, {
          status: REPORT_STATUS.RESOLVED,
          resolution: (appliedDoc.actions || []).some((action) => !action.isProvisional)
            ? REPORT_RESOLUTION_TYPES.ACTION_TAKEN
            : REPORT_RESOLUTION_TYPES.NO_ACTION,
          adminNotes:
            assessment.draftNotes?.adminNote ||
            `Thi hành hàng loạt theo đề xuất của Sentinel AI (${assessment.policyClause}).`,
        });
        executedCount += 1;
        processedIds.push(reportId);
      } catch (err) {
        logger.warn(`[Sentinel Batch Apply] report=${reportId} failed: ${err.code || err.message}`);
        failed.push({ id: reportId, code: err.code || 'INTERNAL_ERROR' });
      }
    }

    return {
      executedCount,
      minConfidence: threshold,
      processedIds,
      skipped,
      failed,
    };
  }

  /**
   * Resolve or dismiss a report. A pending one can only be dismissed (clear spam or duplicate).
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ status: string, resolution: string, adminNotes: string, applyToRelatedReportIds?: string[] }} param2
   */
  async resolveReport(
    adminUserId,
    id,
    { status, resolution, adminNotes, applyToRelatedReportIds = [] },
    { closedCaseId = null, reporterNotice = '' } = {}
  ) {
    const report = await this._getReportDocOrFail(id);

    if (REPORT_CLOSED_STATUSES.includes(report.status)) {
      throw new AppError('Report is already closed', 409, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }
    if ((status === REPORT_STATUS.DISMISSED) !== (resolution === REPORT_RESOLUTION_TYPES.DISMISSED)) {
      throw new AppError('The resolution does not match the status', 400, ADMIN_REPORT_ERRORS.INVALID_RESOLUTION);
    }
    // The outcome must match the sanctions: provisional ones (Auto-Shield) are not a decision
    const hasOfficialSanction = report.actions.some((action) => !action.isProvisional);
    if (resolution === REPORT_RESOLUTION_TYPES.ACTION_TAKEN && !hasOfficialSanction) {
      throw new AppError('Resolved report with action_taken requires at least one action', 400, ADMIN_REPORT_ERRORS.ACTIONS_REQUIRED_FOR_RESOLVE);
    }
    if (resolution !== REPORT_RESOLUTION_TYPES.ACTION_TAKEN && hasOfficialSanction) {
      throw new AppError(
        'Sanctions were applied to this report: it can only be resolved with action_taken',
        400,
        ADMIN_REPORT_ERRORS.RESOLUTION_CONFLICTS_WITH_ACTIONS
      );
    }

    const accountSanctions = report.actions.filter((action) => REPORT_ACCOUNT_SANCTION_TYPES.includes(action.type));
    const closesRelatedReports = applyToRelatedReportIds.length > 0;
    if (closesRelatedReports && (status !== REPORT_STATUS.RESOLVED || accountSanctions.length === 0)) {
      throw new AppError('Related reports can only be resolved with a suspension or a ban', 400, ADMIN_REPORT_ERRORS.RELATED_REPORTS_REQUIRE_SANCTION);
    }

    const note = adminNotes.trim();
    this._closeReport(report, { adminUserId, status, resolution, adminNotes: note, historyNote: note, closedCaseId });
    await safetyService.saveReport(report);
    await this._notifyReporter(report, status, reporterNotice);

    if (closesRelatedReports) {
      const relatedReports = await safetyService.getOpenReportDocsAgainst(report.reportedUserId, applyToRelatedReportIds);
      for (const related of relatedReports) {
        accountSanctions.forEach((action) => {
          related.actions.push({
            type: action.type,
            params: action.params,
            performedBy: adminUserId,
            actorType: 'admin',
            propagatedFrom: report._id,
            performedAt: new Date(),
            note: action.note,
          });
          related.history.push({
            eventType: REPORT_HISTORY_EVENT_TYPES.ACTION_APPLIED,
            fromStatus: related.status,
            toStatus: related.status,
            by: adminUserId,
            actorType: 'admin',
            at: new Date(),
            note: `Áp dụng chế tài ${toActionLabels([action.type])} theo báo cáo chính của cụm`,
            metadata: { actionType: action.type, sourceReportId: report._id },
          });
        });
        this._closeReport(related, {
          adminUserId,
          status,
          resolution,
          adminNotes: note,
          historyNote: `Đóng đồng loạt theo báo cáo chính của cụm: ${note}`,
          historyMetadata: { sourceReportId: report._id },
        });
        await safetyService.saveReport(related);
        await this._notifyReporter(related, status);
      }
    }

    await this._liftRestrictionIfNoneLeft(report.reportedUserId);

    await this._refreshRuleSnapshots(report.reportedUserId);
    return this.getReportDetail(id);
  }

  /**
   * Decide a case in one step: every open report about the same content is closed by this decision.
   * - violation: the chosen sanctions run ONCE, on the report the decision is taken on; the other reports of
   *   the case are closed with it (propagated copies, never an extra strike). No sanction chosen means a
   *   violation without discipline.
   * - no_violation: every report of the case is dismissed.
   * Other open cases against the same parent can be closed with it as the same matter (`alsoCloseReportIds`,
   * one report of each): they get no sanction of their own.
   * Everything is checked before anything runs, so a case is never left half-sanctioned.
   * @param {string} adminUserId
   * @param {string} id - A report of the case
   * @param {{ outcome: string, sanctions?: Array<{ type: string, durationDays?: number }>, notes: string,
   *   isPolicyOverride?: boolean, overrideReason?: string, alsoCloseReportIds?: string[] }} payload
   * @returns {Promise<Object>} Report detail, with `decision: { closedCount, skipped, notApplicable }`
   */
  async decideReport(
    adminUserId,
    id,
    {
      outcome,
      sanctions = [],
      notes,
      isPolicyOverride = false,
      overrideReason = '',
      alsoCloseReportIds = [],
      reportedUserNotice = '',
      reporterNotice = '',
    }
  ) {
    const primary = await this._getReportDocOrFail(id);
    if (REPORT_CLOSED_STATUSES.includes(primary.status)) {
      throw new AppError('Report is already closed', 409, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }
    const note = notes.trim();
    const offenderNotice = (reportedUserNotice || '').trim();
    const reporterText = (reporterNotice || '').trim();
    const primaryId = primary._id.toString();
    const isViolation = outcome === REPORT_DECISIONS.VIOLATION;

    // The other open reports of this case, then the other cases closed with it (each keeps its own row)
    const caseMembers = (await safetyService.getCaseReports(primary.toObject())).filter(
      (member) => String(member._id) !== primaryId
    );
    const otherCases = await this._getCasesClosedTogether(primary, alsoCloseReportIds);
    const followers = [
      ...caseMembers.map((member) => ({ id: String(member._id), closedCaseId: primary._id, report: member })),
      ...otherCases.flatMap(({ caseId, reports }) =>
        reports.map((member) => ({ id: String(member._id), closedCaseId: caseId, report: member }))
      ),
    ];
    const decision = { closedCount: 0, skipped: [], notApplicable: [] };

    if (!isViolation) {
      // A dismissal says there was no violation: impossible once a sanction was decided on one of the reports
      const hasOfficialSanction = [primary, ...followers.map((follower) => follower.report)].some((report) =>
        (report.actions || []).some((action) => !action.isProvisional)
      );
      if (hasOfficialSanction) {
        throw new AppError(
          'Sanctions were applied to this case: it cannot be dismissed',
          400,
          ADMIN_REPORT_ERRORS.RESOLUTION_CONFLICTS_WITH_ACTIONS
        );
      }
      this._closeReport(primary, {
        adminUserId,
        status: REPORT_STATUS.DISMISSED,
        resolution: REPORT_RESOLUTION_TYPES.DISMISSED,
        adminNotes: note,
        historyNote: note,
        closedCaseId: primary._id,
      });
      await safetyService.saveReport(primary);
      await this._notifyReporter(primary, REPORT_STATUS.DISMISSED, reporterText);
      decision.closedCount += 1;

      for (const follower of followers) {
        const doc = await this._getReportDocOrFail(follower.id);
        if (!REPORT_OPEN_STATUSES.includes(doc.status)) continue;
        this._closeReport(doc, {
          adminUserId,
          status: REPORT_STATUS.DISMISSED,
          resolution: REPORT_RESOLUTION_TYPES.DISMISSED,
          adminNotes: note,
          historyNote: `Bác bỏ cùng vụ việc: ${note}`,
          historyMetadata: { sourceReportId: primary._id },
          closedCaseId: follower.closedCaseId,
        });
        await safetyService.saveReport(doc);
        await this._notifyReporter(doc, REPORT_STATUS.DISMISSED, reporterText);
        decision.closedCount += 1;
      }
    } else {
      const plan = await this._planDecisionSanctions(primary, sanctions, { isPolicyOverride, overrideReason });
      decision.notApplicable = plan.notApplicable;
      for (const sanction of plan.executable) {
        await this._executeReportAction(adminUserId, primaryId, {
          type: sanction.type,
          durationDays: sanction.durationDays,
          note,
          isPolicyOverride: sanction.isOverride,
          overrideReason: sanction.isOverride ? overrideReason : '',
          // One notice for the whole decision instead of one per sanction
          isSilent: Boolean(offenderNotice),
        });
      }
      if (offenderNotice && plan.executable.length > 0) {
        await this._sendOffenderNotice(primary.reportedUserId, offenderNotice, primary._id);
      }

      // Reload: each sanction saved a newer version of the report
      const primaryDoc = await this._getReportDocOrFail(primaryId);
      const officialActions = (primaryDoc.actions || []).filter((action) => !action.isProvisional);
      this._closeReport(primaryDoc, {
        adminUserId,
        status: REPORT_STATUS.RESOLVED,
        resolution: officialActions.length > 0 ? REPORT_RESOLUTION_TYPES.ACTION_TAKEN : REPORT_RESOLUTION_TYPES.NO_ACTION,
        adminNotes: note,
        historyNote: note,
        closedCaseId: primaryDoc._id,
      });
      await safetyService.saveReport(primaryDoc);
      await this._notifyReporter(primaryDoc, REPORT_STATUS.RESOLVED, reporterText);
      decision.closedCount += 1;

      for (const follower of followers) {
        const isClosed = await this._closeAsSameCase(
          adminUserId,
          follower.id,
          primaryDoc,
          officialActions,
          note,
          follower.closedCaseId,
          reporterText
        );
        if (isClosed) decision.closedCount += 1;
        else decision.skipped.push({ id: follower.id, reason: 'Báo cáo đã có chế tài riêng hoặc đã đóng' });
      }
    }

    await this._liftRestrictionIfNoneLeft(primary.reportedUserId);
    await this._refreshRuleSnapshots(primary.reportedUserId);
    return { ...(await this.getReportDetail(primaryId)), decision };
  }

  /**
   * The other open cases closed with a decision: one entry per case, with its open reports.
   * @private
   * @param {Document} primary - Report the decision is taken on
   * @param {string[]} reportIds - One report of each case
   * @returns {Promise<Array<{ caseId: ObjectId, reports: Array<Object> }>>}
   */
  async _getCasesClosedTogether(primary, reportIds = []) {
    const ownKey = caseKeyOf(primary);
    const cases = new Map();
    for (const reportId of [...new Set(reportIds.map(String))]) {
      const report = await safetyService.getReportById(reportId);
      if (!report || !REPORT_OPEN_STATUSES.includes(report.status)) continue;
      if (String(report.reportedUserId) !== String(primary.reportedUserId)) {
        throw new AppError('Cases closed together must be against the same parent', 400, ADMIN_REPORT_ERRORS.CLUSTER_MIXED_USERS);
      }
      const key = caseKeyOf(report);
      if (key === ownKey || cases.has(key)) continue;
      const reports = await safetyService.getCaseReports(report);
      cases.set(key, { caseId: reports[0]._id, reports });
    }
    return [...cases.values()];
  }

  /**
   * Check the sanctions of a decision before any of them runs: the policy matrix (a sanction outside it
   * needs an override once the AI assessed the report), the target of each sanction and the account state.
   * @private
   * @returns {Promise<{ executable: Array<{ type: string, durationDays: number|null, isOverride: boolean }>, notApplicable: Array<Object> }>}
   */
  async _planDecisionSanctions(report, sanctions, { isPolicyOverride, overrideReason }) {
    const applied = new Set((report.actions || []).map((action) => action.type));
    // A sanction already on the report (e.g. applied provisionally by the Auto-Shield) is not run twice
    const wanted = [...new Map(sanctions.map((sanction) => [sanction.type, sanction])).values()].filter(
      (sanction) => !applied.has(sanction.type)
    );
    if (wanted.length === 0) return { executable: [], notApplicable: [] };

    const hasAssessment = Boolean(report.sentinelAssessment?.assessedAt);
    const priorCount = await safetyService.countUserPriorSanctions(report.reportedUserId, report);
    const policyResult = hasAssessment
      ? calculatePolicySanction(report.category, report.severity, priorCount, report.targetType)
      : null;
    const checked = wanted.map((sanction) => ({
      type: sanction.type,
      durationDays: sanction.type === REPORT_ACTION_TYPES.SUSPEND ? parseInt(sanction.durationDays, 10) : null,
      isOverride: checkActionPolicyCompliance(sanction.type, policyResult, sanction.durationDays).isOverride,
    }));
    const outside = checked.filter((sanction) => sanction.isOverride);
    if (outside.length > 0 && !isPolicyOverride) {
      throw new AppError(
        `Chế tài "${toActionLabels(outside.map((sanction) => sanction.type))}" không nằm trong khung quy chuẩn cho vi phạm này. Cần tích chọn "Áp dụng ngoại lệ chính sách" và giải trình lý do (ít nhất 20 ký tự).`,
        400,
        'POLICY_OVERRIDE_REQUIRED'
      );
    }
    if (outside.length > 0 && (!overrideReason || overrideReason.trim().length < 20)) {
      throw new AppError(
        'Vui lòng nhập lý do giải trình ngoại lệ chính sách (tối thiểu 20 ký tự).',
        400,
        'OVERRIDE_REASON_REQUIRED'
      );
    }

    const reportedParent = await parentService.getParentById(report.reportedUserId);
    if (!reportedParent) {
      throw new AppError('Reported parent not found', 404, ADMIN_REPORT_ERRORS.REPORTED_USER_NOT_FOUND);
    }
    const targetUser = await userService.liftExpiredSuspension(await userService.getUserById(reportedParent.userId));
    const plan = await sanctionExecutorService.planSanctions({ report, targetUser, actions: checked });
    if (plan.blockers.length > 0) {
      throw new AppError('Reported account not found', 404, ADMIN_REPORT_ERRORS.REPORTED_USER_NOT_FOUND);
    }
    const types = new Set(plan.executable.map((sanction) => sanction.type));
    if (types.has(REPORT_ACTION_TYPES.SUSPEND) && !plan.executable.find((s) => s.type === REPORT_ACTION_TYPES.SUSPEND).durationDays) {
      throw new AppError('durationDays must be at least 1', 400, ADMIN_REPORT_ERRORS.DURATION_DAYS_REQUIRED);
    }
    if (types.has(REPORT_ACTION_TYPES.SUSPEND) && !targetUser.isActive) {
      throw new AppError('This account is already locked', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }
    if (types.has(REPORT_ACTION_TYPES.BAN) && targetUser.banReason) {
      throw new AppError('User is already permanently banned', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }

    // Sanctions on the content first, the account lock last (it signs the parent out)
    const order = [
      REPORT_ACTION_TYPES.DELETE_MESSAGE,
      REPORT_ACTION_TYPES.CANCEL_PLAYDATE,
      REPORT_ACTION_TYPES.WARN,
      REPORT_ACTION_TYPES.SUSPEND,
      REPORT_ACTION_TYPES.BAN,
    ];
    return {
      executable: [...plan.executable].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)),
      notApplicable: plan.notApplicable,
    };
  }

  /**
   * Reopen a closed report: the sanctions already applied stay in effect
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ note: string }} param2
   */
  async reopenReport(adminUserId, id, { note }) {
    const report = await this._getReportDocOrFail(id);

    if (!REPORT_CLOSED_STATUSES.includes(report.status)) {
      throw new AppError('Only closed reports can be reopened', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
    }

    const fromStatus = report.status;
    report.status = REPORT_STATUS.PENDING;
    report.resolution = null;
    report.adminNotes = '';
    report.resolvedBy = null;
    report.resolvedAt = null;
    report.closedCaseId = null;
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.REOPEN,
      fromStatus,
      toStatus: REPORT_STATUS.PENDING,
      by: adminUserId,
      at: new Date(),
      note: note.trim(),
    });

    await safetyService.saveReport(report);
    await this._refreshRuleSnapshots(report.reportedUserId);
    return this.getReportDetail(id);
  }

  /**
   * @private
   */
  async _getReportDocOrFail(id) {
    const report = await safetyService.getReportDocById(id);
    if (!report) {
      throw new AppError('Report not found', 404, ADMIN_REPORT_ERRORS.REPORT_NOT_FOUND);
    }
    return report;
  }

  /**
   * @private
   */
  async _getReportActors(reports) {
    const ids = reports.flatMap((report) => [
      report.resolvedBy,
      ...(report.actions || []).map((action) => action.performedBy),
      ...(report.history || []).map((entry) => entry.by),
    ]);
    const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
    const users = uniqueIds.length > 0 ? await userService.getUsersByIds(uniqueIds) : [];
    return new Map(users.map((user) => [String(user._id), user]));
  }

  /**
   * @private
   */
  async _getReportTargetContext(report) {
    if (report.targetType === REPORT_TARGET_TYPES.MESSAGE && report.targetMessageId) {
      return chatService.getMessageContext(report.targetMessageId);
    }
    if (report.targetType === REPORT_TARGET_TYPES.PLAYDATE && report.targetPlaydateId) {
      try {
        const { playdate, pendingReschedule } = await playdateService.getPlaydateDetailForAdmin(report.targetPlaydateId);
        return { type: 'playdate', playdate: AdminPlaydateDTO.toDetailResponse(playdate, pendingReschedule) };
      } catch (error) {
        if (error.code === 'PLAYDATE_NOT_FOUND') return null;
        throw error;
      }
    }
    if (report.targetType === REPORT_TARGET_TYPES.USER) {
      const childrenCounts = await childService.countActiveChildrenByParentIds([report.reportedUserId]);
      return { type: 'user', childrenCount: childrenCounts.get(String(report.reportedUserId)) || 0 };
    }
    return null;
  }

  /**
   * @private
   */
  _closeReport(report, { adminUserId, status, resolution, adminNotes, historyNote, historyMetadata = {}, closedCaseId = null }) {
    const fromStatus = report.status;
    report.status = status;
    report.resolution = resolution;
    report.adminNotes = adminNotes;
    report.resolvedBy = adminUserId;
    report.resolvedAt = new Date();
    // Reports closed by one decision stay one row of the queue
    report.closedCaseId = closedCaseId || report._id;
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.STATUS_CHANGE,
      fromStatus,
      toStatus: status,
      by: adminUserId,
      at: new Date(),
      note: historyNote,
      metadata: { resolution, ...historyMetadata },
    });
  }

  /**
   * The notice of a decision, sent once to the sanctioned parent (instead of one per sanction)
   * @private
   */
  async _sendOffenderNotice(reportedParentId, body, reportId) {
    const reportedParent = await parentService.getParentById(reportedParentId).catch(() => null);
    if (!reportedParent?.userId) return;
    await this._sendReportNotification({
      recipientId: reportedParent.userId,
      title: 'Thông báo xử lý vi phạm',
      body,
      data: { reportId },
    });
  }

  /**
   * @private
   */
  async _sendReportNotification(notification) {
    try {
      await notificationService.createNotification({ type: NOTIFICATION_TYPES.SYSTEM, ...notification });
    } catch (error) {
      logger.error(`[AdminReports] Notification failed: ${error.message}`);
    }
  }

  /**
   * @private
   */
  /**
   * @param {Object} report
   * @param {string} status
   * @param {string} [body] - Text of the decision (e.g. written by the AI); the generic one when empty
   */
  async _notifyReporter(report, status, body = '') {
    const reporterParent = await parentService.getParentById(report.reporterId);
    if (!reporterParent?.userId) return;
    await this._sendReportNotification({
      recipientId: reporterParent.userId,
      title: 'Cập nhật báo cáo vi phạm',
      body:
        body ||
        (status === REPORT_STATUS.RESOLVED
          ? 'Báo cáo của bạn đã được xử lý theo Quy chuẩn Cộng đồng BuddyLink. Cảm ơn bạn đã chung tay bảo vệ an toàn cho các bé.'
          : 'Báo cáo của bạn đã được xem xét và lưu hồ sơ theo dõi.'),
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _warnReportedUser(report, targetUser, isSilent = false) {
    await userService.addStrike(targetUser._id);
    if (!isSilent) await this._sendReportNotification({
      recipientId: targetUser._id,
      title: 'Cảnh cáo vi phạm an toàn',
      body: `Bạn nhận được 1 cảnh cáo do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category]}. Vui lòng tuân thủ quy tắc để giữ an toàn cho cộng đồng.`,
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _deleteReportedMessage(report, targetUser, isSilent = false) {
    if (report.targetType !== REPORT_TARGET_TYPES.MESSAGE || !report.targetMessageId) {
      throw new AppError('Report is not targeting a message', 400, ADMIN_REPORT_ERRORS.INVALID_ACTION_TYPE);
    }
    const { message, alreadyDeleted } = await chatService.adminDeleteMessage(report.targetMessageId);
    if (!message) {
      throw new AppError('The reported message no longer exists', 404, ADMIN_REPORT_ERRORS.TARGET_NOT_FOUND);
    }
    if (alreadyDeleted) {
      throw new AppError('Message is already deleted', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }
    await moderationRealtimeService.notifyMessageDeleted(message);
    if (!isSilent) await this._sendReportNotification({
      recipientId: targetUser._id,
      title: 'Tin nhắn đã bị gỡ bỏ',
      body: `Một tin nhắn của bạn đã bị Quản trị viên gỡ do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category]}.`,
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _cancelReportedPlaydate(report, note) {
    if (report.targetType !== REPORT_TARGET_TYPES.PLAYDATE || !report.targetPlaydateId) {
      throw new AppError('Report is not targeting a playdate', 400, ADMIN_REPORT_ERRORS.INVALID_ACTION_TYPE);
    }
    try {
      await playdateService.cancelPlaydateByAdmin(report.targetPlaydateId, note || 'Hủy bởi Quản trị viên do vi phạm an toàn');
    } catch (error) {
      if (error.code === 'PLAYDATE_NOT_FOUND') {
        throw new AppError('The reported playdate no longer exists', 404, ADMIN_REPORT_ERRORS.TARGET_NOT_FOUND);
      }
      if (error.code === 'ALREADY_CANCELLED') {
        throw new AppError('Playdate is already cancelled', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
      }
      throw error;
    }
  }

  /**
   * @private
   */
  async _suspendReportedUser(report, targetUser, durationDays, isSilent = false) {
    const days = parseInt(durationDays, 10);
    if (!days || days < 1) {
      throw new AppError('durationDays must be at least 1', 400, ADMIN_REPORT_ERRORS.DURATION_DAYS_REQUIRED);
    }
    if (!targetUser.isActive) {
      throw new AppError('This account is already locked', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }

    const suspensionUntil = new Date(Date.now() + days * DAY_MS);
    const updated = await userService.suspendAccount(targetUser._id, suspensionUntil);
    await this._afterAccountLocked(updated || { _id: targetUser._id, suspensionUntil }, targetUser);
    if (!isSilent) await this._sendReportNotification({
      recipientId: targetUser._id,
      title: 'Tài khoản bị tạm đình chỉ',
      body: `Tài khoản của bạn bị tạm đình chỉ ${days} ngày, đến ${formatNoticeDate(suspensionUntil)}, do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category]}.`,
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _banReportedUser(report, targetUser, note, isSilent = false) {
    if (targetUser.banReason) {
      throw new AppError('User is already permanently banned', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }
    const banReason = note || REPORT_CATEGORY_NOTICES[report.category];
    const updated = await userService.banAccount(targetUser._id, banReason);
    await this._afterAccountLocked(updated || { _id: targetUser._id, banReason }, targetUser);
    if (!isSilent) await this._sendReportNotification({
      recipientId: targetUser._id,
      title: 'Tài khoản bị khóa vĩnh viễn',
      body: `Tài khoản của bạn đã bị khóa vĩnh viễn do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category]}.`,
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _afterAccountLocked(lockedUser, targetUser) {
    await authService.revokeAllUserRefreshTokens(targetUser._id);
    moderationRealtimeService.notifyAccountLocked(lockedUser);
    void emitUserEvent(USER_EVENTS.USER_STATUS_CHANGED, {
      userId: targetUser._id,
      email: targetUser.email,
      isActive: false,
    });
  }

  /**
   * @private
   */
  async _findParentIdsBySearch(search) {
    const [nameMatchIds, emailUserIds] = await Promise.all([
      parentService.findParentIdsByName(search),
      userService.findUserIdsByEmail(search),
    ]);
    const emailParents = await parentService.getParentsByUserIds(emailUserIds);
    const idByKey = new Map([...nameMatchIds, ...emailParents.map((parent) => parent._id)].map((id) => [String(id), id]));
    return [...idByKey.values()];
  }
}

export const adminReportService = new AdminReportService();
export default adminReportService;

