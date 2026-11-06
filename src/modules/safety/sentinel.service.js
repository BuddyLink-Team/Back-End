import axios from 'axios';
import geminiAdapter from '../../integrations/ai/gemini.adapter.js';
import parentService from '../parent/parent.service.js';
import userService from '../user/user.service.js';
import chatService from '../chat/chat.service.js';
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
} from './safety.constants.js';
import logger from '../../shared/logger/index.js';

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
    if (!forceRefresh && report.sentinelAssessment?.assessedAt) {
      return report;
    }

    const [reporter, reportedParent, priorSanctionsCount] = await Promise.all([
      parentService.getParentById(report.reporterId).catch(() => null),
      parentService.getParentById(report.reportedUserId).catch(() => null),
      safetyService.countUserPriorSanctions(report.reportedUserId).catch(() => 0),
    ]);

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

    // Build user content prompt
    const parts = [
      {
        text: `INCIDENT DETAILS:
- Category: ${report.category}
- Initial Severity: ${report.severity}
- Reporter Note: "${report.description || report.reason || 'None provided'}"
- Reported User Prior Sanction Count: ${priorSanctionsCount} strike(s)
- Reporter Name: ${reporter?.fullName || 'Anonymous Parent'}
- Reported User Name: ${reportedParent?.fullName || 'Reported Parent'}

${contextText}

Please analyze this report thoroughly and provide the JSON assessment according to system instructions.`,
      },
    ];

    // Download and attach evidence images if available (up to 3 images for speed)
    const evidenceUrls = (report.evidenceUrls || []).slice(0, 3);
    for (const imgUrl of evidenceUrls) {
      const part = await this._fetchImagePart(imgUrl);
      if (part) parts.push(part);
    }

    let parsedResult = null;
    try {
      const aiResponse = await geminiAdapter.generateContent({
        systemInstruction: SENTINEL_PROMPT_INSTRUCTION,
        contents: [{ role: 'user', parts }],
        allowTools: false,
      });

      const cleaned = (aiResponse.text || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      parsedResult = JSON.parse(cleaned);
    } catch (err) {
      logger.error(`[Sentinel] Gemini AI assessment parsing error: ${err.message}`);
      // Fallback deterministic assessment if model fails
      parsedResult = {
        summary: `Hệ thống ghi nhận báo cáo thuộc danh mục "${report.category}" với mức độ "${report.severity}". Cần quản trị viên kiểm tra trực tiếp.`,
        violationType: report.category,
        severity: report.severity || REPORT_SEVERITY.MEDIUM,
        confidenceScore: 70,
        evidenceAnalysis: {
          isValid: report.evidenceUrls?.length > 0,
          notes: 'Không thể tự động phân tích hình ảnh bằng chứng vào lúc này.',
        },
        draftNotes: {
          adminNote: `Xử lý vi phạm theo quy chuẩn chính sách danh mục ${report.category}.`,
          reportedUserNotice: 'Tài khoản của bạn đã có hành vi vi phạm Quy chế Cộng đồng của BuddyLink.',
          reporterFeedback: 'Cảm ơn bạn đã gửi báo cáo. Chúng tôi đã tiến hành xem xét và xử lý vi phạm.',
        },
      };
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

    report.sentinelAssessment = {
      summary: parsedResult.summary || '',
      violationType: parsedResult.violationType || report.category,
      severityRecommendation: policyResult.suggestedSeverity,
      confidenceScore: Math.min(100, Math.max(0, parseInt(parsedResult.confidenceScore, 10) || 80)),
      strikeCount: policyResult.strikeCount,
      policyClause: policyResult.clause,
      evidenceAnalysis: {
        isValid: parsedResult.evidenceAnalysis?.isValid ?? (report.evidenceUrls?.length > 0),
        notes: parsedResult.evidenceAnalysis?.notes || '',
      },
      recommendedSanctions: policyResult.standardActions,
      draftNotes: {
        adminNote: parsedResult.draftNotes?.adminNote || '',
        reportedUserNotice: parsedResult.draftNotes?.reportedUserNotice || '',
        reporterFeedback: parsedResult.draftNotes?.reporterFeedback || '',
      },
      assessedAt: new Date(),
      assessedByModel: 'gemini-3.5',
      autoShieldApplied: Boolean(isCriticalChildSafety),
    };

    const actorId = adminUserId || report.reporterId;

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.SENTINEL_ASSESSED,
      fromStatus: report.status,
      toStatus: report.status,
      by: actorId,
      at: new Date(),
      note: `Sentinel AI thẩm định: Mức ${report.sentinelAssessment.severityRecommendation.toUpperCase()} (Độ tự tin: ${report.sentinelAssessment.confidenceScore}%)`,
      metadata: {
        confidenceScore: report.sentinelAssessment.confidenceScore,
        severity: report.sentinelAssessment.severityRecommendation,
        strikeCount: report.sentinelAssessment.strikeCount,
      },
    });

    if (isCriticalChildSafety) {
      await this._executeAutoShield(report, reportedParent, policyResult, actorId);
    }

    await safetyService.saveReport(report);
    return report;
  }

  /**
   * Execute emergency Auto-Shield protection for high-confidence critical/child-safety reports:
   * - Escalate severity to CRITICAL
   * - Transition status from PENDING -> REVIEWING automatically
   * - Auto-delete offending message (if message report)
   * - Auto-suspend reported account for 7 days while awaiting final Admin permanent ban decision
   * @private
   */
  async _executeAutoShield(report, reportedParent, policyResult, actorId) {
    const prevStatus = report.status;
    report.severity = REPORT_SEVERITY.CRITICAL;

    if (report.status === REPORT_STATUS.PENDING) {
      report.status = REPORT_STATUS.REVIEWING;
    }

    const shieldActionsTaken = [];

    // 1. Auto-delete harmful message immediately if targeting a message
    if (
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

    // 2. Auto-freeze (suspend 7 days) the reported account immediately if still active
    if (
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

    const actionsSummary =
      shieldActionsTaken.length > 0
        ? `Đã tự động ${shieldActionsTaken.join(' & ')}.`
        : 'Đã nâng mức độ lên Khẩn cấp (Critical).';

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.AUTO_SHIELDED,
      fromStatus: prevStatus,
      toStatus: report.status,
      by: actorId,
      at: new Date(),
      note: `🛡️ Sentinel Auto-Shield kích hoạt: Tự động chuyển trạng thái sang Đang xem xét. ${actionsSummary}`,
    });
  }
}

export const sentinelService = new SentinelService();
export default sentinelService;
