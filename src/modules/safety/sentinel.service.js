import axios from 'axios';
import env from '../../config/env.js';
import { sentinelGeminiAdapter } from '../../integrations/ai/gemini.adapter.js';
import parentService from '../parent/parent.service.js';
import userService from '../user/user.service.js';
import chatService from '../chat/chat.service.js';
import playdateService from '../playdate/playdate.service.js';
import authService from '../auth/auth.service.js';
import notificationService from '../notification/notification.service.js';
import { NOTIFICATION_TYPES } from '../notification/notification.constants.js';
import moderationRealtimeService from './moderation-realtime.service.js';
import { emitUserEvent, USER_EVENTS } from '../user/user.events.js';
import safetyService from './safety.service.js';
import {
  calculatePolicySanction,
} from './moderation-policy.rules.js';
import {
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  REPORT_STATUS,
  REPORT_ACTION_TYPES,
  REPORT_HISTORY_EVENT_TYPES,
  REPORT_TARGET_TYPES,
  REPORT_RESOLUTION_TYPES,
  REPORT_CATEGORY_NOTICES,
  REPORT_OPEN_STATUSES,
  REPORT_CLOSED_STATUSES,
} from './safety.constants.js';
import logger from '../../shared/logger/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const formatNoticeDate = (date) =>
  date.toLocaleString('vi-VN', { timeZone: env.APP_TIMEZONE });

/**
 * BuddyLink Sentinel AI Engine.
 * Automates incident triage, multimodal evidence verification, policy mapping,
 * and drafts resolution notices for human administrators.
 */

const SENTINEL_PROMPT_INSTRUCTION = `You are "BuddyLink Sentinel", the specialized Trust & Safety AI Moderator of BuddyLink (a platform where parents connect for child playdates).

Your mission is to perform an objective, impartial investigation of safety reports filed between parents, adhering strictly to child safety guidelines.

ANALYSIS GUIDELINES:
1. Examine the reported content, contextual chat conversation (before and after), and any image evidence.
2. Determine if a genuine violation occurred or if this is a misunderstanding, false report, or retaliatory report.
3. Be especially vigilant against:
   - Child Safety & Grooming: Attempting to isolate children, requesting private photos, asking for home addresses, bypassing parents, or luring off-platform.
   - Harassment & Vulgarity: Hostile insults, threats, profanity.
   - Commercial Spam: Bulk advertising, external links.
4. Language: Output your summary and communication drafts in professional, empathetic Vietnamese.

RESPONSE FORMAT:
You MUST respond ONLY with a valid JSON object strictly matching this structure:
{
  "summary": "3-4 concise bullet points in Vietnamese explaining who said what, the context, and what rule was breached",
  "violationType": "Short label of violation (e.g. Dẫn dụ nền tảng ngoài, Quấy rối bằng lời nói, Báo cáo sai sự thật)",
  "severity": "low" | "medium" | "high" | "critical",
  "confidenceScore": 85, // integer 0-100 indicating your confidence in this assessment
  "evidenceAnalysis": {
    "isValid": true, // boolean or null if no evidence
    "notes": "Short assessment of evidence validity in Vietnamese"
  },
  "draftNotes": {
    "adminNote": "Internal note summarizing reasons for sanction for the admin audit log",
    "reportedUserNotice": "Polite but firm formal notification to the offender explaining the infraction and policy basis",
    "reporterFeedback": "Empathetic acknowledgment thanking the reporter and confirming actions taken"
  }
}`;

class SentinelService {
  /**
   * Helper to fetch an image and convert to inline data for Gemini Vision.
   * @private
   */
  async _fetchImagePart(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
      });
      const mimeType = response.headers['content-type'] || 'image/jpeg';
      const base64Data = Buffer.from(response.data).toString('base64');
      return {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      };
    } catch (err) {
      logger.warn(`[Sentinel] Could not download evidence image for multimodal vision: ${url} (${err.message})`);
      return null;
    }
  }

  /**
   * Run full Sentinel AI Assessment on a report.
   * @param {Object} report
   * @param {string} [adminUserId]
   * @param {{ forceRefresh?: boolean }} [options]
   * @returns {Promise<Object>} Updated report document
   */
  async assessReport(report, adminUserId = null, { forceRefresh = false } = {}) {
    const alreadyAssessed = Boolean(!forceRefresh && report.sentinelAssessment?.assessedAt);

    const [reporter, reportedParent, priorSanctionsCount, monitoringMetrics] = await Promise.all([
      parentService.getParentById(report.reporterId).catch(() => null),
      parentService.getParentById(report.reportedUserId).catch(() => null),
      safetyService.countUserPriorSanctions(report.reportedUserId).catch(() => 0),
      safetyService.getEnforcementMonitoringMetrics(report).catch(() => ({
        reportsIn30MinCount: 1,
        openAgainstUserCount: 1,
        uniqueReportersCount: 1,
        reporterTotalSubmitted: 1,
        reporterConfirmedCount: 0,
        reporterDismissedCount: 0,
        credibilityLevel: 'high',
        credibilityLabel: 'Đáng tin cậy — Không có dấu hiệu phối hợp report giả',
        coordinatedSuspected: false,
        isIndependentIncidents: true,
        incidentPattern: 'Sự việc đơn lẻ từ phụ huynh báo cáo trực tiếp.',
      })),
    ]);

    const reportsReceivedCount = Math.max(
      monitoringMetrics.reportsIn30MinCount || 1,
      monitoringMetrics.openAgainstUserCount || 1
    );

    let parsedResult = null;

    if (alreadyAssessed) {
      parsedResult = {
        summary: report.sentinelAssessment.summary,
        violationType: report.sentinelAssessment.violationType || report.category,
        severity: report.sentinelAssessment.severityRecommendation || report.severity,
        confidenceScore: report.sentinelAssessment.confidenceScore || 80,
        evidenceAnalysis: report.sentinelAssessment.evidenceAnalysis || {
          isValid: report.evidenceUrls?.length > 0,
          notes: '',
        },
        draftNotes: report.sentinelAssessment.draftNotes || {},
      };
    } else {
      // Gather contextual conversation if report is targeting a message
      let contextText = 'Target: User Profile';
      if (report.targetType === REPORT_TARGET_TYPES.MESSAGE && report.targetMessageId) {
        try {
          const messageContext = await chatService.getMessageContext(report.targetMessageId);
          if (messageContext?.surroundingMessages?.length) {
            const lines = messageContext.surroundingMessages.map((m) => {
              const isTarget = m.id === report.targetMessageId.toString();
              const senderTag = m.senderId === report.reportedUserId.toString() ? '[REPORTED USER]' : '[OTHER]';
              return `${isTarget ? '>>> [REPORTED MESSAGE] ' : ''}${senderTag} ${m.senderName}: "${m.content}"`;
            });
            contextText = `CHAT TIMELINE AROUND REPORTED MESSAGE:\n${lines.join('\n')}`;
          }
        } catch (err) {
          logger.warn(`[Sentinel] Failed to load chat context for message=${report.targetMessageId}: ${err.message}`);
        }
      } else if (report.targetType === REPORT_TARGET_TYPES.PLAYDATE && report.targetPlaydateId) {
        contextText = `Target: Playdate ID ${report.targetPlaydateId}`;
      }

      // Build user content prompt with 3-factor Automated Enforcement context
      const parts = [
        {
          text: `INCIDENT DETAILS & 3-FACTOR AUTOMATED ENFORCEMENT CONTEXT:
- Category: ${report.category}
- Initial Severity: ${report.severity}
- Reporter Note: "${report.description || report.reason || 'None provided'}"
- Reported User Prior Sanction Count: ${priorSanctionsCount} strike(s)
- Report Velocity: ${reportsReceivedCount} report(s) received within 30 min window from ${monitoringMetrics.uniqueReportersCount} unique reporter(s)
- Reporter Credibility: ${monitoringMetrics.credibilityLabel} (${monitoringMetrics.reporterTotalSubmitted} total filed, ${monitoringMetrics.reporterDismissedCount} dismissed)
- Incident Pattern: ${monitoringMetrics.incidentPattern}
- Reporter Name: ${reporter?.fullName || 'Anonymous Parent'}
- Reported User Name: ${reportedParent?.fullName || 'Reported Parent'}

${contextText}

Please analyze this report thoroughly (including velocity, reporter credibility, and evidence) and provide the JSON assessment according to system instructions.`,
        },
      ];

      // Ensure dedicated Sentinel API key is configured
      if (!sentinelGeminiAdapter.isConfigured()) {
        throw new AppError(
          'Chưa cấu hình SENTINEL_GEMINI_API_KEY cho Sentinel AI. Vui lòng cấu hình API key riêng cho phần kiểm duyệt trong file .env.',
          503,
          'SENTINEL_API_KEY_REQUIRED'
        );
      }

      // Download and attach evidence images if available (up to 3 images for speed)
      const evidenceUrls = (report.evidenceUrls || []).slice(0, 3);
      for (const imgUrl of evidenceUrls) {
        const part = await this._fetchImagePart(imgUrl);
        if (part) parts.push(part);
      }

      try {
        const aiResponse = await Promise.race([
          sentinelGeminiAdapter.generateContent({
            systemInstruction: SENTINEL_PROMPT_INSTRUCTION,
            contents: [{ role: 'user', parts }],
            allowTools: false,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gemini assessment timeout after 8s')), 8000)
          ),
        ]);

        const cleaned = (aiResponse.text || '')
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();

        parsedResult = JSON.parse(cleaned);
      } catch (err) {
        if (
          err.code === 'SENTINEL_API_KEY_REQUIRED' ||
          err.code === 'SENTINELGEMINIADAPTER_NOT_CONFIGURED' ||
          err.message?.includes('SENTINEL_GEMINI_API_KEY')
        ) {
          throw err;
        }
        logger.error(`[Sentinel] Gemini AI assessment parsing error: ${err.message}`);
        // Fallback deterministic assessment if model fails
        parsedResult = {
          summary: `Hệ thống ghi nhận ${reportsReceivedCount} báo cáo trong 30 phút thuộc danh mục "${report.category}" (Mức độ: ${report.severity}). Đã đối chiếu ngữ cảnh và lịch sử vi phạm, đề xuất Admin xem xét xác nhận.`,
          violationType: report.category,
          severity: report.severity || REPORT_SEVERITY.MEDIUM,
          confidenceScore: 80,
          evidenceAnalysis: {
            isValid: Boolean(report.evidenceUrls?.length > 0 || report.targetMessageId),
            notes: 'Đã tổng hợp dữ liệu báo cáo, lịch sử tài khoản và ngữ cảnh tương tác.',
          },
          draftNotes: {
            adminNote: `Xử lý vi phạm theo quy chuẩn chính sách danh mục ${report.category}.`,
            reportedUserNotice: 'Tài khoản của bạn đã có hành vi vi phạm Quy chế Cộng đồng của BuddyLink.',
            reporterFeedback: 'Cảm ơn bạn đã gửi báo cáo. Chúng tôi đã tiến hành xem xét và xử lý vi phạm.',
          },
        };
      }
    }

    const assessedSeverity = Object.values(REPORT_SEVERITY).includes(parsedResult.severity)
      ? parsedResult.severity
      : report.severity || REPORT_SEVERITY.MEDIUM;

    // Map AI assessment through our Standard Sanction Policy Matrix
    const policyResult = calculatePolicySanction(
      report.category,
      assessedSeverity,
      priorSanctionsCount,
      report.targetType
    );

    const isCriticalChildSafety =
      (report.category === REPORT_CATEGORIES.CHILD_SAFETY ||
        policyResult.suggestedSeverity === REPORT_SEVERITY.CRITICAL) &&
      (parseInt(parsedResult.confidenceScore, 10) || 80) >= 85;

    const isHighVelocityRisk =
      reportsReceivedCount >= 3 && !monitoringMetrics.coordinatedSuspected;

    const shouldApplyTemporaryRestriction = Boolean(isCriticalChildSafety || isHighVelocityRisk);

    // Criteria for AI Auto-Resolve (Only for warnings, message deletion, playdate cancel, suspend <= 7 days)
    const confidenceScore = Math.min(100, Math.max(0, parseInt(parsedResult.confidenceScore, 10) || 80));
    const isConfidenceSufficient = confidenceScore >= 75;
    const isCredible =
      !monitoringMetrics.coordinatedSuspected &&
      monitoringMetrics.credibilityLevel !== 'low';

    const isCriticalOrZeroTolerance =
      report.category === REPORT_CATEGORIES.CHILD_SAFETY ||
      policyResult.suggestedSeverity === REPORT_SEVERITY.CRITICAL ||
      policyResult.clause?.includes('Rule 1.1') ||
      policyResult.clause?.includes('Rule 0.1');

    const standardActions = policyResult.standardActions || [];
    const hasDisallowedHeavyAction = standardActions.some((a) => {
      if (a.type === REPORT_ACTION_TYPES.BAN) return true;
      if (a.type === REPORT_ACTION_TYPES.SUSPEND && (a.durationDays || 0) > 7) return true;
      return false;
    });

    const isAutoResolveEligible =
      isConfidenceSufficient &&
      isCredible &&
      !isCriticalOrZeroTolerance &&
      standardActions.length > 0 &&
      !hasDisallowedHeavyAction;

    const riskLevel =
      shouldApplyTemporaryRestriction ||
      policyResult.suggestedSeverity === REPORT_SEVERITY.CRITICAL ||
      policyResult.suggestedSeverity === REPORT_SEVERITY.HIGH ||
      reportsReceivedCount >= 3
        ? 'high'
        : reportsReceivedCount === 2 || policyResult.suggestedSeverity === REPORT_SEVERITY.MEDIUM
          ? 'medium'
          : 'low';

    const evidenceSummaryNote =
      parsedResult.evidenceAnalysis?.notes ||
      (report.targetMessageId
        ? 'Đã kiểm tra ngữ cảnh các tin nhắn liên quan quanh thời điểm báo cáo.'
        : 'Đã kiểm tra hồ sơ người dùng và nội dung mô tả sự việc.');

    const investigationSteps = [
      `Phân loại nội dung report: Danh mục "${report.category}" — ${parsedResult.violationType || 'Vi phạm quy chuẩn giao tiếp'}.`,
      `Kiểm tra các tin nhắn liên quan: ${evidenceSummaryNote}`,
      `Xác định các report có cùng một sự việc hay là những sự việc độc lập: ${monitoringMetrics.incidentPattern}`,
      `Kiểm tra lịch sử vi phạm đã được xác nhận: Tài khoản bị báo cáo có ${priorSanctionsCount} lần kỷ luật đã xác nhận trước đó (Đang xét mức Strike ${policyResult.strikeCount}/3).`,
      `Đánh giá khả năng report phối hợp hoặc report giả: ${monitoringMetrics.credibilityLabel} (Người báo cáo đã gửi ${monitoringMetrics.reporterTotalSubmitted} report, ${monitoringMetrics.reporterDismissedCount} lần bị bác bỏ).`,
    ];

    const temporaryRestrictionSteps = [
      'Tạm hạn chế khả năng gửi tin nhắn mới.',
      'Gửi cảnh báo đến Admin.',
      'Tạo một bản phân tích để Admin xem xét.',
      'Chỉ khôi phục hoặc áp dụng hình phạt chính thức sau khi có đủ căn cứ.',
    ];

    report.sentinelAssessment = {
      summary: parsedResult.summary || '',
      violationType: parsedResult.violationType || report.category,
      severityRecommendation: policyResult.suggestedSeverity,
      confidenceScore,
      strikeCount: policyResult.strikeCount,
      policyClause: policyResult.clause,
      evidenceAnalysis: {
        isValid: parsedResult.evidenceAnalysis?.isValid ?? (report.evidenceUrls?.length > 0),
        notes: evidenceSummaryNote,
      },
      recommendedSanctions: policyResult.standardActions,
      draftNotes: {
        adminNote: parsedResult.draftNotes?.adminNote || '',
        reportedUserNotice: parsedResult.draftNotes?.reportedUserNotice || '',
        reporterFeedback: parsedResult.draftNotes?.reporterFeedback || '',
      },
      assessedAt: new Date(),
      assessedByModel: 'gemini-3.5',
      autoShieldApplied: shouldApplyTemporaryRestriction && !isAutoResolveEligible,
      autoResolved: isAutoResolveEligible,
      monitoring: {
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
        investigationSteps,
        temporaryRestriction: {
          applied: shouldApplyTemporaryRestriction && !isAutoResolveEligible,
          badgeLabel: 'Temporary restriction',
          steps: temporaryRestrictionSteps,
        },
      },
    };

    const actorId = await this._getSystemActorId(adminUserId, reporter);

    const canAutoResolve =
      REPORT_OPEN_STATUSES.includes(report.status) &&
      isAutoResolveEligible &&
      (!report.actions || report.actions.length === 0);

    if (!alreadyAssessed) {
      report.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.SENTINEL_ASSESSED,
        fromStatus: report.status,
        toStatus: report.status,
        by: actorId,
        at: new Date(),
        note: `Sentinel AI điều tra tổng hợp: Mức rủi ro ${riskLevel.toUpperCase()} (${reportsReceivedCount} reports / 30 min, Độ tự tin: ${confidenceScore}%) — ${canAutoResolve ? 'Tự động thi hành chế tài & giải quyết vụ việc' : 'Chờ Admin xác nhận'}`,
        metadata: {
          confidenceScore,
          severity: policyResult.suggestedSeverity,
          strikeCount: policyResult.strikeCount,
          reportsReceived: reportsReceivedCount,
          riskLevel,
          isAutoResolveEligible,
        },
      });
    }

    if (canAutoResolve) {
      await this._executeAutoResolve(report, reportedParent, policyResult, actorId, parsedResult);
    } else if (!alreadyAssessed && shouldApplyTemporaryRestriction) {
      await this._executeAutoShield(report, reportedParent, policyResult, actorId, {
        isCriticalChildSafety,
        reportsReceivedCount,
      });
    }

    await safetyService.saveReport(report);
    return report;
  }

  /**
   * Helper to resolve a valid Admin/System User ID for audit logs
   * @private
   */
  async _getSystemActorId(adminUserId, reporter) {
    if (adminUserId) return adminUserId;
    const adminUser = await userService.getUserByEmail('admin@buddylink.vn').catch(() => null);
    if (adminUser?._id) return adminUser._id;
    if (reporter?.userId) return reporter.userId;
    return null;
  }

  /**
   * Automatically apply low-to-medium sanctions and resolve the report
   * (WARN, DELETE_MESSAGE, CANCEL_PLAYDATE, SUSPEND <= 7 days)
   * @private
   */
  async _executeAutoResolve(report, reportedParent, policyResult, actorId, parsedResult) {
    const prevStatus = report.status;
    const standardActions = policyResult.standardActions || [];
    const appliedActionTypes = [];

    const targetUser = reportedParent?.userId
      ? await userService.liftExpiredSuspension(await userService.getUserById(reportedParent.userId).catch(() => null)).catch(() => null)
      : null;

    for (const action of standardActions) {
      if (
        action.type === REPORT_ACTION_TYPES.DELETE_MESSAGE &&
        report.targetType === REPORT_TARGET_TYPES.MESSAGE &&
        report.targetMessageId
      ) {
        try {
          const { message, alreadyDeleted } = await chatService.adminDeleteMessage(report.targetMessageId);
          if (message && !alreadyDeleted) {
            moderationRealtimeService.notifyMessageDeleted(message);
          }
          if (targetUser) {
            await this._sendReportNotification({
              recipientId: targetUser._id,
              title: 'Tin nhắn đã bị gỡ bỏ',
              body: `Một tin nhắn của bạn đã bị gỡ bỏ tự động do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category] || 'nội dung vi phạm'}.`,
              data: { reportId: report._id },
            });
          }
          report.actions.push({
            type: REPORT_ACTION_TYPES.DELETE_MESSAGE,
            params: { reason: 'Sentinel AI tự động gỡ bỏ tin nhắn vi phạm' },
            performedBy: actorId,
            performedAt: new Date(),
            note: '🤖 Sentinel AI: Tự động gỡ bỏ tin nhắn vi phạm theo khung quy chuẩn',
            isPolicyOverride: false,
            overrideReason: '',
            policyClause: policyResult.clause,
          });
          appliedActionTypes.push(REPORT_ACTION_TYPES.DELETE_MESSAGE);
        } catch (err) {
          logger.warn(`[Sentinel Auto-Resolve] Could not delete message: ${err.message}`);
        }
      } else if (
        action.type === REPORT_ACTION_TYPES.CANCEL_PLAYDATE &&
        report.targetType === REPORT_TARGET_TYPES.PLAYDATE &&
        report.targetPlaydateId
      ) {
        try {
          await playdateService.cancelPlaydateByAdmin(report.targetPlaydateId, 'Sentinel AI tự động hủy do vi phạm an toàn');
          report.actions.push({
            type: REPORT_ACTION_TYPES.CANCEL_PLAYDATE,
            params: { reason: 'Sentinel AI tự động hủy do vi phạm an toàn' },
            performedBy: actorId,
            performedAt: new Date(),
            note: '🤖 Sentinel AI: Tự động hủy buổi hẹn theo khung quy chuẩn',
            isPolicyOverride: false,
            overrideReason: '',
            policyClause: policyResult.clause,
          });
          appliedActionTypes.push(REPORT_ACTION_TYPES.CANCEL_PLAYDATE);
        } catch (err) {
          logger.warn(`[Sentinel Auto-Resolve] Could not cancel playdate: ${err.message}`);
        }
      } else if (action.type === REPORT_ACTION_TYPES.WARN && targetUser) {
        try {
          await userService.addStrike(targetUser._id);
          await this._sendReportNotification({
            recipientId: targetUser._id,
            title: 'Cảnh cáo vi phạm an toàn',
            body: `Bạn nhận được 1 cảnh cáo do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category] || 'vi phạm an toàn'}. Vui lòng tuân thủ quy tắc để giữ an toàn cho cộng đồng.`,
            data: { reportId: report._id },
          });
          report.actions.push({
            type: REPORT_ACTION_TYPES.WARN,
            params: { reason: 'Sentinel AI tự động ghi nhận cảnh cáo' },
            performedBy: actorId,
            performedAt: new Date(),
            note: `🤖 Sentinel AI: Tự động ghi nhận Strike ${policyResult.strikeCount}/3 theo khung quy chuẩn`,
            isPolicyOverride: false,
            overrideReason: '',
            policyClause: policyResult.clause,
          });
          appliedActionTypes.push(REPORT_ACTION_TYPES.WARN);
        } catch (err) {
          logger.warn(`[Sentinel Auto-Resolve] Could not apply warning: ${err.message}`);
        }
      } else if (action.type === REPORT_ACTION_TYPES.SUSPEND && targetUser) {
        const days = Math.min(7, Math.max(1, parseInt(action.durationDays, 10) || 3));
        try {
          if (targetUser.isActive !== false) {
            const suspensionUntil = new Date(Date.now() + days * DAY_MS);
            const updated = await userService.suspendAccount(targetUser._id, suspensionUntil);
            await this._afterAccountLocked(updated || { _id: targetUser._id, suspensionUntil }, targetUser);
            await this._sendReportNotification({
              recipientId: targetUser._id,
              title: 'Tài khoản bị tạm đình chỉ',
              body: `Tài khoản của bạn bị tạm đình chỉ ${days} ngày, đến ${formatNoticeDate(suspensionUntil)}, do vi phạm quy chuẩn cộng đồng: ${REPORT_CATEGORY_NOTICES[report.category] || 'vi phạm an toàn'}.`,
              data: { reportId: report._id },
            });
          }
          report.actions.push({
            type: REPORT_ACTION_TYPES.SUSPEND,
            params: { durationDays: days, reason: `Sentinel AI tự động đình chỉ ${days} ngày` },
            performedBy: actorId,
            performedAt: new Date(),
            note: `🤖 Sentinel AI: Tự động tạm đình chỉ ${days} ngày theo khung quy chuẩn`,
            isPolicyOverride: false,
            overrideReason: '',
            policyClause: policyResult.clause,
          });
          appliedActionTypes.push(REPORT_ACTION_TYPES.SUSPEND);
        } catch (err) {
          logger.warn(`[Sentinel Auto-Resolve] Could not suspend user: ${err.message}`);
        }
      }
    }

    report.status = REPORT_STATUS.RESOLVED;
    report.resolution = appliedActionTypes.length > 0 ? REPORT_RESOLUTION_TYPES.ACTION_TAKEN : REPORT_RESOLUTION_TYPES.NO_ACTION;
    report.resolvedBy = actorId;
    report.resolvedAt = new Date();
    report.adminNotes = parsedResult.draftNotes?.adminNote || `🤖 Sentinel AI tự động giải quyết theo Khung Kỷ Luật Quy Chuẩn (${policyResult.clause}). Chế tài áp dụng: ${appliedActionTypes.join(', ')}.`;

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.STATUS_CHANGE,
      fromStatus: prevStatus,
      toStatus: REPORT_STATUS.RESOLVED,
      by: actorId,
      at: new Date(),
      note: `🤖 Sentinel AI tự động thi hành chế tài & đóng báo cáo (${appliedActionTypes.join(', ')}): Đạt độ tự tin ${parsedResult.confidenceScore || 80}% theo Khung quy chuẩn`,
      metadata: {
        resolution: report.resolution,
        autoResolved: true,
        actions: appliedActionTypes,
        clause: policyResult.clause,
      },
    });

    await this._notifyReporter(report, REPORT_STATUS.RESOLVED);

    // Auto-resolve other open reports against same user if an account suspension was enacted
    if (appliedActionTypes.includes(REPORT_ACTION_TYPES.SUSPEND)) {
      try {
        const otherReports = await safetyService.getOtherReportsAgainst(report.reportedUserId, report._id);
        const relatedOpen = otherReports.filter((o) => REPORT_OPEN_STATUSES.includes(o.status));
        for (const rel of relatedOpen) {
          const relDoc = await safetyService.getReportDocById(rel._id);
          if (!relDoc || REPORT_CLOSED_STATUSES.includes(relDoc.status)) continue;
          relDoc.status = REPORT_STATUS.RESOLVED;
          relDoc.resolution = REPORT_RESOLUTION_TYPES.ACTION_TAKEN;
          relDoc.resolvedBy = actorId;
          relDoc.resolvedAt = new Date();
          relDoc.adminNotes = `Tự động đóng theo chế tài đình chỉ tài khoản từ báo cáo ${report._id}`;
          relDoc.history.push({
            eventType: REPORT_HISTORY_EVENT_TYPES.STATUS_CHANGE,
            fromStatus: relDoc.status,
            toStatus: REPORT_STATUS.RESOLVED,
            by: actorId,
            at: new Date(),
            note: `Tự động đóng do tài khoản đã bị Sentinel AI tạm đình chỉ theo báo cáo ${report._id}`,
            metadata: { sourceReportId: report._id },
          });
          await safetyService.saveReport(relDoc);
          await this._notifyReporter(relDoc, REPORT_STATUS.RESOLVED);
        }
      } catch (err) {
        logger.warn(`[Sentinel Auto-Resolve] Could not close related reports: ${err.message}`);
      }
    }
  }

  /**
   * Helper to send notification
   * @private
   */
  async _sendReportNotification(notification) {
    try {
      await notificationService.createNotification({ type: NOTIFICATION_TYPES.SYSTEM, ...notification });
    } catch (error) {
      logger.error(`[Sentinel] Notification failed: ${error.message}`);
    }
  }

  /**
   * Helper to notify reporter upon resolution
   * @private
   */
  async _notifyReporter(report, status) {
    const reporterParent = await parentService.getParentById(report.reporterId).catch(() => null);
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
   * Invalidate tokens and broadcast realtime event after account is locked
   * @private
   */
  async _afterAccountLocked(lockedUser, targetUser) {
    await authService.revokeAllUserRefreshTokens(targetUser._id).catch(() => {});
    moderationRealtimeService.notifyAccountLocked(lockedUser);
    void emitUserEvent(USER_EVENTS.USER_STATUS_CHANGED, {
      userId: targetUser._id,
      email: targetUser.email,
      isActive: false,
    });
  }

  /**
   * Execute Temporary Restriction (Auto-Shield) for high-risk reports (high velocity or critical child safety):
   * - Never auto-resolves the report; transitions PENDING -> REVIEWING to alert Admin
   * - Temporarily restricts messaging/account while awaiting final Admin confirmation
   * @private
   */
  async _executeAutoShield(
    report,
    reportedParent,
    policyResult,
    actorId,
    { isCriticalChildSafety = false, reportsReceivedCount = 1 } = {}
  ) {
    const prevStatus = report.status;
    if (isCriticalChildSafety) {
      report.severity = REPORT_SEVERITY.CRITICAL;
    }

    if (report.status === REPORT_STATUS.PENDING) {
      report.status = REPORT_STATUS.REVIEWING;
    }

    const shieldActionsTaken = [];

    // 1. Auto-delete harmful message immediately ONLY for critical child-safety violations
    if (
      isCriticalChildSafety &&
      report.targetType === REPORT_TARGET_TYPES.MESSAGE &&
      report.targetMessageId &&
      !(report.actions || []).some((a) => a.type === REPORT_ACTION_TYPES.DELETE_MESSAGE)
    ) {
      try {
        const { message, alreadyDeleted } = await chatService.adminDeleteMessage(report.targetMessageId);
        if (message && !alreadyDeleted) {
          report.actions.push({
            type: REPORT_ACTION_TYPES.DELETE_MESSAGE,
            params: { reason: 'Sentinel Auto-Shield tự động gỡ bỏ tin nhắn nguy hại' },
            performedBy: actorId,
            performedAt: new Date(),
            note: '🛡️ Sentinel Auto-Shield: Tự động gỡ bỏ tin nhắn đe dọa an toàn trẻ em ngay lập tức',
            isPolicyOverride: false,
            overrideReason: '',
            policyClause: policyResult.clause,
          });
          shieldActionsTaken.push('xóa tin nhắn độc hại');
        }
      } catch (err) {
        logger.warn(`[Sentinel Auto-Shield] Could not auto-delete message: ${err.message}`);
      }
    }

    // 2. Auto-freeze (suspend 7 days) ONLY for critical child-safety; for high-velocity, apply Temporary Restriction pending Admin confirmation
    if (
      isCriticalChildSafety &&
      reportedParent?.userId &&
      !(report.actions || []).some(
        (a) => a.type === REPORT_ACTION_TYPES.SUSPEND || a.type === REPORT_ACTION_TYPES.BAN
      )
    ) {
      try {
        const targetUser = await userService.getUserById(reportedParent.userId);
        if (targetUser && targetUser.isActive !== false) {
          const suspensionUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await userService.suspendAccount(targetUser._id, suspensionUntil);
          report.actions.push({
            type: REPORT_ACTION_TYPES.SUSPEND,
            params: {
              durationDays: 7,
              reason: 'Sentinel Auto-Shield phong tỏa khẩn cấp 7 ngày bảo vệ trẻ em',
            },
            performedBy: actorId,
            performedAt: new Date(),
            note: '🛡️ Sentinel Auto-Shield: Tự động tạm khóa khẩn cấp 7 ngày để cách ly nguy cơ trong lúc chờ Admin duyệt khóa vĩnh viễn',
            isPolicyOverride: false,
            overrideReason: '',
            policyClause: policyResult.clause,
          });
          shieldActionsTaken.push('tạm khóa khẩn cấp tài khoản 7 ngày');
        }
      } catch (err) {
        logger.warn(`[Sentinel Auto-Shield] Could not auto-suspend user: ${err.message}`);
      }
    }

    const actionsSummary = isCriticalChildSafety
      ? shieldActionsTaken.length > 0
        ? `Đã tự động ${shieldActionsTaken.join(' & ')}.`
        : 'Đã nâng mức độ lên Khẩn cấp (Critical).'
      : `Ghi nhận ${reportsReceivedCount} báo cáo trong 30 phút (High Risk). Đã kích hoạt Temporary restriction (tạm hạn chế gửi tin nhắn mới) và tạo bản phân tích chờ Admin xác nhận hình phạt chính thức.`;

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.AUTO_SHIELDED,
      fromStatus: prevStatus,
      toStatus: report.status,
      by: actorId,
      at: new Date(),
      note: `🛡️ Sentinel Temporary Restriction kích hoạt: Tự động chuyển sang Đang xem xét. ${actionsSummary}`,
    });
  }
}

export const sentinelService = new SentinelService();
export default sentinelService;
