import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import authService from '../auth/auth.service.js';
import playdateService from '../playdate/playdate.service.js';
import safetyService from '../safety/safety.service.js';
import sentinelService from '../safety/sentinel.service.js';
import { calculatePolicySanction, checkActionPolicyCompliance } from '../safety/moderation-policy.rules.js';
import chatService from '../chat/chat.service.js';
import notificationService from '../notification/notification.service.js';
import { NOTIFICATION_TYPES } from '../notification/notification.constants.js';
import moderationRealtimeService from '../safety/moderation-realtime.service.js';
import logger from '../../shared/logger/index.js';
import env from '../../config/env.js';
import AppError from '../../shared/exceptions/app-error.js';
import { getZonedParts, getZonedDayRange } from '../../shared/helpers/date.helper.js';
import { ADMIN_REPORT_ERRORS } from './admin.constants.js';
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
   * Moderation queue: severity then oldest first, unless another order is asked for
   * @param {Object} queryParams
   * @param {string|ObjectId} currentAdminUserId - Who assignedTo=me is
   */
  async getReports(queryParams, currentAdminUserId) {
    const paging = toPaging(queryParams);
    const search = queryParams.search?.trim();

    const { items: reports, total } = await safetyService.findReportPage({
      status: queryParams.status,
      severity: queryParams.severity,
      category: queryParams.category,
      targetType: queryParams.targetType,
      assignedTo: queryParams.assignedTo === 'me' ? currentAdminUserId : queryParams.assignedTo,
      from: toDateBound(queryParams.fromDate),
      to: toDateBound(queryParams.toDate, { endOfDay: true }),
      search,
      searchParentIds: search ? await this._findParentIdsBySearch(search) : [],
      overdueBefore: toOptionalBoolean(queryParams.isOverdue) ? toOverdueCutoffs() : undefined,
      sort: queryParams.sort,
      ...paging,
    });

    const parentIds = [...new Set(reports.flatMap((report) => [String(report.reporterId), String(report.reportedUserId)]))];
    const parents = await parentService.getParentsByIds(parentIds);
    const [users, actorsById, messageContents] = await Promise.all([
      userService.getUsersByIds(parents.map((parent) => parent.userId).filter(Boolean)),
      this._getReportActors(reports),
      chatService.getMessageContents(reports.map((report) => report.targetMessageId).filter(Boolean)),
    ]);
    const parentById = new Map(parents.map((parent) => [String(parent._id), parent]));
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const toUser = (parent) => (parent ? userById.get(String(parent.userId)) : null);

    return {
      items: reports.map((report) => {
        const reporterParent = parentById.get(String(report.reporterId));
        const reportedParent = parentById.get(String(report.reportedUserId));
        return AdminReportListItemDTO.toResponse({
          report,
          reporterParent,
          reporterUser: toUser(reporterParent),
          reportedParent,
          reportedUser: toUser(reportedParent),
          actorsById,
          isOverdue: checkIsOverdue(report),
          reportedMessageContent: report.targetMessageId
            ? messageContents.get(String(report.targetMessageId)) || null
            : null,
        });
      }),
      pagination: toPagination(paging, total),
    };
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

    const priorSanctionsCount = await safetyService.countUserPriorSanctions(report.reportedUserId, report._id);
    const policyGuidance = report.sentinelAssessment?.assessedAt
      ? calculatePolicySanction(report.category, report.severity, priorSanctionsCount, report.targetType)
      : null;

    if (report.sentinelAssessment?.assessedAt && !report.sentinelAssessment.monitoring?.investigationSteps?.length) {
      const monitoringMetrics = await safetyService.getEnforcementMonitoringMetrics(report);
      const reportsReceivedCount = Math.max(
        monitoringMetrics.reportsIn30MinCount || 1,
        monitoringMetrics.openAgainstUserCount || 1
      );
      const isHighRisk =
        Boolean(report.sentinelAssessment.autoShieldApplied) ||
        report.severity === REPORT_SEVERITY.CRITICAL ||
        report.severity === REPORT_SEVERITY.HIGH ||
        reportsReceivedCount >= 3;
      const riskLevel = isHighRisk ? 'high' : reportsReceivedCount === 2 ? 'medium' : 'low';
      const evidenceNote =
        report.sentinelAssessment.evidenceAnalysis?.notes ||
        (report.targetMessageId
          ? 'Đã kiểm tra ngữ cảnh các tin nhắn liên quan quanh thời điểm báo cáo.'
          : 'Đã kiểm tra hồ sơ người dùng và nội dung mô tả sự việc.');

      report.sentinelAssessment.monitoring = {
        reportsReceived: reportsReceivedCount,
        timeWindow: '30 min',
        totalOpenAgainstUser: monitoringMetrics.openAgainstUserCount,
        uniqueReportersCount: monitoringMetrics.uniqueReportersCount,
        riskLevel,
        reporterCredibility: {
          level: monitoringMetrics.credibilityLevel,
          label: monitoringMetrics.credibilityLabel,
          totalSubmitted: monitoringMetrics.reporterTotalSubmitted,
          confirmedCount: monitoringMetrics.reporterConfirmedCount,
          dismissedCount: monitoringMetrics.reporterDismissedCount,
          coordinatedSuspected: monitoringMetrics.coordinatedSuspected,
          isIndependentIncidents: monitoringMetrics.isIndependentIncidents,
          incidentPattern: monitoringMetrics.incidentPattern,
        },
        investigationSteps: [
          `Phân loại nội dung report: Danh mục "${report.category}" — ${report.sentinelAssessment.violationType || 'Vi phạm quy chuẩn giao tiếp'}.`,
          `Kiểm tra các tin nhắn liên quan: ${evidenceNote}`,
          `Xác định các report có cùng một sự việc hay là những sự việc độc lập: ${monitoringMetrics.incidentPattern}`,
          `Kiểm tra lịch sử vi phạm đã được xác nhận: Tài khoản bị báo cáo có ${priorSanctionsCount} lần kỷ luật đã xác nhận trước đó (Đang xét mức Strike ${policyGuidance?.strikeCount || 1}/3).`,
          `Đánh giá khả năng report phối hợp hoặc report giả: ${monitoringMetrics.credibilityLabel} (Người báo cáo đã gửi ${monitoringMetrics.reporterTotalSubmitted} report, ${monitoringMetrics.reporterDismissedCount} lần bị bác bỏ).`,
        ],
        temporaryRestriction: {
          applied: isHighRisk,
          badgeLabel: 'Temporary restriction',
          steps: [
            'Tạm hạn chế khả năng gửi tin nhắn mới.',
            'Gửi cảnh báo đến Admin.',
            'Tạo một bản phân tích để Admin xem xét.',
            'Chỉ khôi phục hoặc áp dụng hình phạt chính thức sau khi có đủ căn cứ.',
          ],
        },
      };
    }

    return AdminReportDetailDTO.toResponse({
      report,
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
      isOverdue: checkIsOverdue(report),
      totalReportsSubmitted,
    });
  }

  /**
   * Claim or take over a report
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ action: 'claim' | 'takeover' }} param2
   */
  async reviewReport(adminUserId, id, { action }) {
    const report = await this._getReportDocOrFail(id);

    if (action === 'claim') {
      if (!REPORT_OPEN_STATUSES.includes(report.status)) {
        throw new AppError('Can only claim pending or reviewing reports', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
      }
      const fromStatus = report.status;
      report.status = REPORT_STATUS.REVIEWING;
      report.assignedTo = adminUserId;
      report.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.CLAIM,
        fromStatus,
        toStatus: REPORT_STATUS.REVIEWING,
        by: adminUserId,
        at: new Date(),
        note: 'Tiếp nhận xử lý vụ việc',
      });
    } else if (action === 'takeover') {
      if (report.status !== REPORT_STATUS.REVIEWING) {
        throw new AppError('Can only takeover reports in reviewing status', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
      }
      report.assignedTo = adminUserId;
      report.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.TAKEOVER,
        fromStatus: REPORT_STATUS.REVIEWING,
        toStatus: REPORT_STATUS.REVIEWING,
        by: adminUserId,
        at: new Date(),
        note: 'Tiếp quản xử lý vụ việc từ người khác',
      });
    }

    await safetyService.saveReport(report);
    return this.getReportDetail(id);
  }

  /**
   * Update report severity during review
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ severity: string, note?: string }} param2
   */
  async updateReportSeverity(adminUserId, id, { severity, note }) {
    const report = await this._getReportDocOrFail(id);

    if (report.status !== REPORT_STATUS.REVIEWING) {
      throw new AppError('Can only change severity when reviewing', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
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
    return this.getReportDetail(id);
  }

  /**
   * Apply a sanction, through the service of the module that owns its target
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ type: string, durationDays?: number, note?: string, isPolicyOverride?: boolean, overrideReason?: string }} param2
   */
  async applyReportAction(adminUserId, id, { type, durationDays, note, isPolicyOverride = false, overrideReason = '' }) {
    const report = await this._getReportDocOrFail(id);

    if (REPORT_CLOSED_STATUSES.includes(report.status)) {
      throw new AppError('Cannot apply action on closed report', 409, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }
    if (report.status !== REPORT_STATUS.REVIEWING) {
      throw new AppError('Start reviewing the report before applying an action', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
    }
    if (!REPORT_SANCTION_TYPES.includes(type)) {
      throw new AppError('This action cannot be applied as a sanction', 400, ADMIN_REPORT_ERRORS.INVALID_ACTION_TYPE);
    }
    if ((report.actions || []).some((action) => action.type === type)) {
      throw new AppError('This action has already been applied to this report', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }

    this._assertActionTarget(report, type);

    const hasAssessment = Boolean(report.sentinelAssessment?.assessedAt);
    const priorCount = await safetyService.countUserPriorSanctions(report.reportedUserId, report._id);
    const policyResult = hasAssessment
      ? calculatePolicySanction(report.category, report.severity, priorCount, report.targetType)
      : null;
    const { isOverride: requiredOverride } = checkActionPolicyCompliance(type, policyResult, durationDays);

    if (requiredOverride && !isPolicyOverride) {
      throw new AppError(
        `Chế tài "${type}" không nằm trong khung quy chuẩn cho vi phạm ${report.category} (${report.severity}). Cần tích chọn "Áp dụng ngoại lệ chính sách (Policy Override)" và giải trình lý do (ít nhất 20 ký tự).`,
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
      [REPORT_ACTION_TYPES.WARN]: () => this._warnReportedUser(report, targetUser),
      [REPORT_ACTION_TYPES.DELETE_MESSAGE]: () => this._deleteReportedMessage(report, targetUser),
      [REPORT_ACTION_TYPES.CANCEL_PLAYDATE]: () => this._cancelReportedPlaydate(report, note),
      [REPORT_ACTION_TYPES.SUSPEND]: () => this._suspendReportedUser(report, targetUser, durationDays),
      [REPORT_ACTION_TYPES.BAN]: () => this._banReportedUser(report, targetUser, note),
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
        ? `Đã thi hành chế tài (Ngoại lệ chính sách): ${type} - Lý do: ${overrideReason}`
        : `Đã thi hành chế tài theo quy chuẩn: ${type}`,
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
        note: `Ngoại lệ chính sách cho "${type}": ${overrideReason}`,
        metadata: { actionType: type, overrideReason },
      });
    }

    await safetyService.saveReport(report);
    return this.getReportDetail(id);
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
   * 1-Click Approve Sentinel recommendations
   * @param {string} adminUserId
   * @param {string} id
   */
  async applySentinelRecommendation(adminUserId, id) {
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

    if (currentReport.status === REPORT_STATUS.PENDING) {
      currentReport.status = REPORT_STATUS.REVIEWING;
      currentReport.assignedTo = adminUserId;
      currentReport.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.CLAIM,
        fromStatus: REPORT_STATUS.PENDING,
        toStatus: REPORT_STATUS.REVIEWING,
        by: adminUserId,
        at: new Date(),
        note: 'Tiếp nhận xử lý vụ việc qua Sentinel 1-Click Approve',
      });
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

    const recommended = assessment.recommendedSanctions || [];
    for (const sanction of recommended) {
      if (sanction.type === REPORT_ACTION_TYPES.DELETE_MESSAGE && currentReport.targetType !== REPORT_TARGET_TYPES.MESSAGE) {
        continue;
      }
      if (sanction.type === REPORT_ACTION_TYPES.CANCEL_PLAYDATE && currentReport.targetType !== REPORT_TARGET_TYPES.PLAYDATE) {
        continue;
      }
      const alreadyApplied = (currentReport.actions || []).some((a) => a.type === sanction.type);
      if (!alreadyApplied && REPORT_SANCTION_TYPES.includes(sanction.type)) {
        try {
          await this.applyReportAction(adminUserId, id, {
            type: sanction.type,
            durationDays: sanction.durationDays,
            note: sanction.reason || assessment.draftNotes?.adminNote || `Thi hành theo đề xuất Sentinel (${assessment.policyClause})`,
            isPolicyOverride: false,
          });
        } catch (err) {
          if (
            err.code !== ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED &&
            err.code !== ADMIN_REPORT_ERRORS.TARGET_NOT_FOUND
          ) {
            currentReport.history.push({
              eventType: REPORT_HISTORY_EVENT_TYPES.ACTION_APPLIED,
              fromStatus: currentReport.status,
              toStatus: currentReport.status,
              by: adminUserId,
              actorType: 'admin',
              at: new Date(),
              note: `ACTION_FAILED: Thất bại khi áp dụng ${sanction.type} (${err.message})`,
              metadata: { actionType: sanction.type, error: err.message },
            });
            await safetyService.saveReport(currentReport);
          }
        }
      }
    }

    const updatedDoc = await this._getReportDocOrFail(id);
    const hasAccountSanction = (updatedDoc.actions || []).some((a) =>
      REPORT_ACCOUNT_SANCTION_TYPES.includes(a.type)
    );
    let applyToRelatedReportIds = [];
    if (hasAccountSanction) {
      const otherReports = await safetyService.getOtherReportsAgainst(updatedDoc.reportedUserId, updatedDoc._id);
      applyToRelatedReportIds = otherReports
        .filter((other) => REPORT_OPEN_STATUSES.includes(other.status))
        .map((other) => other._id.toString());
    }

    return this.resolveReport(adminUserId, id, {
      status: REPORT_STATUS.RESOLVED,
      resolution: (updatedDoc.actions || []).length > 0
        ? REPORT_RESOLUTION_TYPES.ACTION_TAKEN
        : REPORT_RESOLUTION_TYPES.NO_ACTION,
      adminNotes: assessment.draftNotes?.adminNote || `Đã giải quyết theo đề xuất của Sentinel AI (${assessment.policyClause}).`,
      applyToRelatedReportIds,
    });
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

    const targets = items.filter((r) => {
      if (r.status === REPORT_STATUS.REVIEWING && r.assignedTo && String(r.assignedTo) !== String(adminUserId)) {
        return false;
      }
      return true;
    });

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

    const { items: refreshedItems } = await this.getReports({
      page: 1,
      limit: 20,
      statuses: REPORT_OPEN_STATUSES,
    });

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

    for (const candidate of items) {
      const freshDoc = await safetyService.getReportDocById(candidate._id);
      if (!freshDoc || REPORT_CLOSED_STATUSES.includes(freshDoc.status)) {
        continue;
      }

      const assessment = freshDoc.sentinelAssessment;
      if (!assessment?.assessedAt) {
        skipped.push({ id: freshDoc._id.toString(), reason: 'Chưa có đánh giá từ Sentinel AI' });
        continue;
      }
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

      await this.applySentinelRecommendation(adminUserId, freshDoc._id.toString());
      executedCount += 1;
      processedIds.push(freshDoc._id.toString());
    }

    return {
      executedCount,
      minConfidence: threshold,
      processedIds,
      skipped,
    };
  }

  /**
   * Resolve or dismiss a report. A pending one can only be dismissed (clear spam or duplicate).
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ status: string, resolution: string, adminNotes: string, applyToRelatedReportIds?: string[] }} param2
   */
  async resolveReport(adminUserId, id, { status, resolution, adminNotes, applyToRelatedReportIds = [] }) {
    const report = await this._getReportDocOrFail(id);

    if (REPORT_CLOSED_STATUSES.includes(report.status)) {
      throw new AppError('Report is already closed', 409, ADMIN_REPORT_ERRORS.REPORT_ALREADY_CLOSED);
    }
    if (status === REPORT_STATUS.RESOLVED && report.status !== REPORT_STATUS.REVIEWING) {
      throw new AppError('A report must be reviewed before it is resolved', 400, ADMIN_REPORT_ERRORS.INVALID_STATUS_TRANSITION);
    }
    if ((status === REPORT_STATUS.DISMISSED) !== (resolution === REPORT_RESOLUTION_TYPES.DISMISSED)) {
      throw new AppError('The resolution does not match the status', 400, ADMIN_REPORT_ERRORS.INVALID_RESOLUTION);
    }
    if (resolution === REPORT_RESOLUTION_TYPES.ACTION_TAKEN && report.actions.length === 0) {
      throw new AppError('Resolved report with action_taken requires at least one action', 400, ADMIN_REPORT_ERRORS.ACTIONS_REQUIRED_FOR_RESOLVE);
    }

    const accountSanctions = report.actions.filter((action) => REPORT_ACCOUNT_SANCTION_TYPES.includes(action.type));
    const closesRelatedReports = applyToRelatedReportIds.length > 0;
    if (closesRelatedReports && (status !== REPORT_STATUS.RESOLVED || accountSanctions.length === 0)) {
      throw new AppError('Related reports can only be resolved with a suspension or a ban', 400, ADMIN_REPORT_ERRORS.RELATED_REPORTS_REQUIRE_SANCTION);
    }

    const note = adminNotes.trim();
    this._closeReport(report, { adminUserId, status, resolution, adminNotes: note, historyNote: note });
    await safetyService.saveReport(report);
    await this._notifyReporter(report, status);

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
            note: `Áp dụng chế tài ${action.type} theo báo cáo ${report._id}`,
            metadata: { actionType: action.type, sourceReportId: report._id },
          });
        });
        this._closeReport(related, {
          adminUserId,
          status,
          resolution,
          adminNotes: note,
          historyNote: `Đóng đồng loạt theo báo cáo ${report._id}: ${note}`,
          historyMetadata: { sourceReportId: report._id },
        });
        await safetyService.saveReport(related);
        await this._notifyReporter(related, status);
      }
    }

    // Check if reported user has other open restricted reports; if not, lift messaging restriction
    const hasRemainingRestricted = await safetyService.hasOpenRestrictedReports(report.reportedUserId);
    if (!hasRemainingRestricted) {
      const reportedParent = await parentService.getParentById(report.reportedUserId).catch(() => null);
      if (reportedParent?.userId) {
        await userService.liftMessagingRestriction(reportedParent.userId).catch(() => {});
      }
    }

    return this.getReportDetail(id);
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
    report.status = REPORT_STATUS.REVIEWING;
    report.resolution = null;
    report.adminNotes = '';
    report.resolvedBy = null;
    report.resolvedAt = null;
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.REOPEN,
      fromStatus,
      toStatus: REPORT_STATUS.REVIEWING,
      by: adminUserId,
      at: new Date(),
      note: note.trim(),
    });

    await safetyService.saveReport(report);
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
      report.assignedTo,
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
  _closeReport(report, { adminUserId, status, resolution, adminNotes, historyNote, historyMetadata = {} }) {
    const fromStatus = report.status;
    report.status = status;
    report.resolution = resolution;
    report.adminNotes = adminNotes;
    report.resolvedBy = adminUserId;
    report.resolvedAt = new Date();
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
  async _notifyReporter(report, status) {
    const reporterParent = await parentService.getParentById(report.reporterId);
    if (!reporterParent?.userId) return;
    await this._sendReportNotification({
      recipientId: reporterParent.userId,
      title: 'Cập nhật báo cáo vi phạm',
      body:
        status === REPORT_STATUS.RESOLVED
          ? 'Báo cáo của bạn đã được xử lý theo Quy chuẩn Cộng đồng BuddyLink. Cảm ơn bạn đã chung tay bảo vệ an toàn cho các bé.'
          : 'Báo cáo của bạn đã được xem xét và lưu hồ sơ theo dõi.',
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _warnReportedUser(report, targetUser) {
    await userService.addStrike(targetUser._id);
    await this._sendReportNotification({
      recipientId: targetUser._id,
      title: 'Cảnh cáo vi phạm an toàn',
      body: `Bạn nhận được 1 cảnh cáo do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category]}. Vui lòng tuân thủ quy tắc để giữ an toàn cho cộng đồng.`,
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _deleteReportedMessage(report, targetUser) {
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
    await this._sendReportNotification({
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
  async _suspendReportedUser(report, targetUser, durationDays) {
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
    await this._sendReportNotification({
      recipientId: targetUser._id,
      title: 'Tài khoản bị tạm đình chỉ',
      body: `Tài khoản của bạn bị tạm đình chỉ ${days} ngày, đến ${formatNoticeDate(suspensionUntil)}, do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category]}.`,
      data: { reportId: report._id },
    });
  }

  /**
   * @private
   */
  async _banReportedUser(report, targetUser, note) {
    if (targetUser.banReason) {
      throw new AppError('User is already permanently banned', 409, ADMIN_REPORT_ERRORS.ACTION_ALREADY_APPLIED);
    }
    const banReason = note || REPORT_CATEGORY_NOTICES[report.category];
    const updated = await userService.banAccount(targetUser._id, banReason);
    await this._afterAccountLocked(updated || { _id: targetUser._id, banReason }, targetUser);
    await this._sendReportNotification({
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

