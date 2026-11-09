/**
 * Pure business rules for computing 3-Factor Automated Enforcement metrics:
 * 1. Velocity Analysis (windowed report volume and unique reporters)
 * 2. Reporter Credibility (reporter history and account age)
 * 3. Incident Pattern (independent vs suspected coordinated brigading)
 * 4. Corroboration (distinct parents reporting the same violation within days)
 */

/** Investigation step shown once the messaging restriction is really applied */
export const RESTRICTION_STEP =
  'Tự động kích hoạt hạn chế nhắn tin tạm thời (tối đa 72h) để bảo vệ an toàn cộng đồng';

/**
 * Calculates report velocity metrics from reports occurring within a 30-minute window.
 * @param {Array<Object>} reportsIn30Min
 * @returns {{
 *   reportsIn30MinCount: number,
 *   uniqueReportersCount: number,
 *   velocityReporters: Set<string>,
 *   riskLevel: 'low' | 'medium' | 'high',
 *   isHighVelocityRisk: boolean
 * }}
 */
export function calculateVelocity(reportsIn30Min = []) {
  const reportsIn30MinCount = reportsIn30Min.length;
  const velocityReporters = new Set(reportsIn30Min.map((r) => String(r.reporterId || '')));
  velocityReporters.delete('');
  const uniqueReportersCount = Math.max(1, velocityReporters.size);

  const isHighVelocity = velocityReporters.size >= 3;
  const isMediumVelocity = velocityReporters.size === 2;

  const riskLevel = isHighVelocity ? 'high' : isMediumVelocity ? 'medium' : 'low';

  return {
    reportsIn30MinCount,
    uniqueReportersCount,
    velocityReporters,
    riskLevel,
    isHighVelocityRisk: isHighVelocity,
  };
}

/**
 * Calculates credibility for the reporting user.
 * @param {Object} [reporter] - Parent / User object with createdAt
 * @param {{ totalSubmitted: number, confirmedCount: number, dismissedCount: number }} outcomes
 * @param {{ coordinatedSuspected?: boolean }} [options]
 * @returns {{
 *   level: 'high' | 'normal' | 'low',
 *   label: string,
 *   totalSubmitted: number,
 *   confirmedCount: number,
 *   dismissedCount: number
 * }}
 */
export function calculateCredibility(reporter, outcomes = {}, options = {}) {
  const totalSubmitted = Math.max(1, outcomes.totalSubmitted || 1);
  const confirmedCount = outcomes.confirmedCount || 0;
  const dismissedCount = outcomes.dismissedCount || 0;
  const coordinatedSuspected = Boolean(options.coordinatedSuspected);

  // Check account age (in days)
  let accountAgeDays = null;
  if (reporter?.createdAt) {
    const createdDate = new Date(reporter.createdAt);
    accountAgeDays = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
  }

  // Account age < 7 days or 0 confirmed reports -> credibility 'normal'
  const isNewAccount = accountAgeDays !== null && accountAgeDays < 7;
  const hasNoConfirmedHistory = confirmedCount === 0;

  let level = 'high';
  let label = 'Đáng tin cậy — Lịch sử báo cáo tốt, không có dấu hiệu phối hợp báo cáo ảo';

  if (dismissedCount >= 2 && dismissedCount > confirmedCount) {
    level = 'low';
    label = `Độ tin cậy thấp — Người báo cáo từng có ${dismissedCount} báo cáo bị bác bỏ`;
  } else if (coordinatedSuspected) {
    level = 'normal';
    label = 'Cần lưu ý — Nhiều báo cáo đổ về cùng lúc, cần Admin đối chiếu bằng chứng';
  } else if (isNewAccount || hasNoConfirmedHistory) {
    level = 'normal';
    label = isNewAccount
      ? 'Bình thường — Tài khoản mới tạo dưới 7 ngày, cần thẩm tra bằng chứng'
      : 'Bình thường — Chưa có tiền sử xác thực báo cáo, cần thẩm tra';
  }

  return {
    level,
    label,
    totalSubmitted,
    confirmedCount,
    dismissedCount,
  };
}

/**
 * Assesses whether multiple reports are independent incidents or suspected coordinated brigading.
 * Based solely on reportsIn30Min.
 * @param {Array<Object>} reportsIn30Min
 * @returns {{
 *   coordinatedSuspected: boolean,
 *   isIndependentIncidents: boolean,
 *   incidentPattern: string
 * }}
 */
export function calculatePattern(reportsIn30Min = []) {
  const uniqueReporters = new Set(reportsIn30Min.map((r) => String(r.reporterId || '')));
  uniqueReporters.delete('');
  const uniqueReportersCount = Math.max(1, uniqueReporters.size);

  const hasDirectTargets = reportsIn30Min.some(
    (r) => Boolean(r.targetMessageId) || Boolean(r.targetPlaydateId) || (Array.isArray(r.evidenceUrls) && r.evidenceUrls.length > 0)
  );
  const distinctTargetMessages = new Set(
    reportsIn30Min.map((r) => (r.targetMessageId ? String(r.targetMessageId) : null)).filter(Boolean)
  );

  let coordinatedSuspected = false;
  let isIndependentIncidents = true;
  let incidentPattern =
    'Sự việc đơn lẻ từ phụ huynh báo cáo trực tiếp, không có dấu hiệu nhiều tài khoản phối hợp báo cáo.';

  if (uniqueReportersCount >= 2) {
    if (!hasDirectTargets && distinctTargetMessages.size === 0 && uniqueReportersCount >= 3) {
      coordinatedSuspected = true;
      isIndependentIncidents = false;
      incidentPattern = `Cảnh báo: Ghi nhận ${uniqueReportersCount} tài khoản cùng báo cáo trong 30 phút nhưng thiếu bằng chứng trực tiếp (cần kiểm tra khả năng nhiều tài khoản phối hợp báo cáo ảo).`;
    } else {
      coordinatedSuspected = false;
      isIndependentIncidents = true;
      incidentPattern = `Ghi nhận ${reportsIn30Min.length} báo cáo từ ${uniqueReportersCount} phụ huynh độc lập với ngữ cảnh tương tác riêng biệt (không phải báo cáo giả phối hợp).`;
    }
  }

  return {
    coordinatedSuspected,
    isIndependentIncidents,
    incidentPattern,
  };
}

/**
 * Builds the complete monitoring snapshot structure for sentinel assessment.
 * @param {Object} report
 * @param {Object} data
 * @param {Array<Object>} data.reportsIn30Min
 * @param {Array<Object>} data.openAgainstUser
 * @param {Object} data.reporter
 * @param {Object} data.outcomes
 * @param {Object} [policy]
 * @returns {Object}
 */
export function buildMonitoringSnapshot(report, data, policy = {}) {
  const { reportsIn30Min = [], openAgainstUser = [], reporter = null, outcomes = {} } = data;

  const velocity = calculateVelocity(reportsIn30Min);
  const pattern = calculatePattern(reportsIn30Min);
  const credibility = calculateCredibility(reporter, outcomes, {
    coordinatedSuspected: pattern.coordinatedSuspected,
  });

  // Many reports without direct evidence (suspected brigading) must never restrict the target
  const shouldApplyTempRestriction = Boolean(
    !pattern.coordinatedSuspected &&
      (velocity.isHighVelocityRisk ||
        policy.requiresTemporaryRestriction ||
        (report.severity === 'critical' && reportsIn30Min.length >= 2))
  );

  const steps = [
    'Giám sát phòng thủ tự động',
    `Cửa sổ 30 phút: ${velocity.reportsIn30MinCount} báo cáo từ ${velocity.uniqueReportersCount} người báo cáo`,
    `Độ tin cậy người báo cáo: ${credibility.label}`,
    pattern.incidentPattern,
  ];

  if (shouldApplyTempRestriction) {
    steps.push(RESTRICTION_STEP);
  }

  return {
    reportsReceived: velocity.reportsIn30MinCount,
    timeWindow: '30 phút',
    totalOpenAgainstUser: openAgainstUser.length,
    uniqueReportersCount: velocity.uniqueReportersCount,
    riskLevel: velocity.riskLevel,
    reporterCredibility: {
      level: credibility.level,
      label: credibility.label,
      totalSubmitted: credibility.totalSubmitted,
      confirmedCount: credibility.confirmedCount,
      dismissedCount: credibility.dismissedCount,
      coordinatedSuspected: pattern.coordinatedSuspected,
      isIndependentIncidents: pattern.isIndependentIncidents,
      incidentPattern: pattern.incidentPattern,
    },
    investigationSteps: steps,
    temporaryRestriction: {
      applied: shouldApplyTempRestriction,
      badgeLabel: 'Tạm hạn chế gửi tin nhắn (72h)',
      steps: shouldApplyTempRestriction
        ? [
            'Hạn chế gửi tin nhắn trong 72 giờ hoặc cho đến khi Admin xử lý',
          ]
        : [],
    },
  };
}

/**
 * Settles the restriction part of a snapshot on what was really done, so an assessment that only
 * recommends a restriction (no enforcement) never shows it as applied.
 * @param {Object} snapshot - From buildMonitoringSnapshot
 * @param {boolean} applied - Whether the messaging restriction was really enforced
 * @returns {Object}
 */
export function withRestrictionOutcome(snapshot, applied) {
  if (applied) return snapshot;
  return {
    ...snapshot,
    investigationSteps: snapshot.investigationSteps.filter(
      (step) => step !== RESTRICTION_STEP
    ),
    temporaryRestriction: {
      ...snapshot.temporaryRestriction,
      applied: false,
      steps: [],
    },
  };
}

/** Days before or after a report in which reports from other parents corroborate it */
export const CORROBORATION_WINDOW_DAYS = 7;
/** Distinct parents needed before Sentinel may sanction without an admin */
export const MIN_CORROBORATING_REPORTERS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

const hasDirectEvidence = (r) =>
  Boolean(r?.targetMessageId || r?.targetPlaydateId || (Array.isArray(r?.evidenceUrls) && r.evidenceUrls.length > 0));

/**
 * Key of the incident a report is about: every report on the same playdate / message is one incident,
 * a profile report is its own incident.
 * @param {Object} report
 * @returns {string}
 */
export function incidentKeyOf(report) {
  if (report?.targetPlaydateId) return `playdate:${report.targetPlaydateId}`;
  if (report?.targetMessageId) return `message:${report.targetMessageId}`;
  return `report:${report?._id}`;
}

/**
 * Cross-check a report against the other open reports on the same user: a sanction is only automated
 * when enough distinct parents reported the same kind of violation, with evidence, within days of it.
 * Reports from parents with a low credibility (mostly dismissed reports) never count.
 * @param {Object} report - Report being assessed
 * @param {Array<Object>} openReports - Open reports against the same user (may include `report`)
 * @param {{ lowCredibilityReporterIds?: Array<string> }} [options]
 * @returns {{
 *   isCorroborated: boolean,
 *   reporterCount: number,
 *   requiredReporters: number,
 *   incidentCount: number,
 *   windowDays: number,
 *   relatedReportIds: Array<string>
 * }}
 */
export function calculateCorroboration(report, openReports = [], options = {}) {
  const lowCredibility = new Set((options.lowCredibilityReporterIds || []).map(String));
  const anchor = report?.createdAt ? new Date(report.createdAt).getTime() : Date.now();
  // Both sides: a report filed later still corroborates an earlier one when it is looked at again
  const windowStart = anchor - CORROBORATION_WINDOW_DAYS * DAY_MS;
  const windowEnd = anchor + CORROBORATION_WINDOW_DAYS * DAY_MS;

  const byId = new Map();
  [report, ...openReports].forEach((r) => {
    if (r?._id && !byId.has(String(r._id))) byId.set(String(r._id), r);
  });

  const counted = [...byId.values()].filter((r) => {
    const createdAt = r.createdAt ? new Date(r.createdAt).getTime() : anchor;
    return (
      r.category === report.category &&
      createdAt >= windowStart &&
      createdAt <= windowEnd &&
      hasDirectEvidence(r) &&
      !lowCredibility.has(String(r.reporterId))
    );
  });

  const reporterCount = new Set(counted.map((r) => String(r.reporterId))).size;

  return {
    isCorroborated: reporterCount >= MIN_CORROBORATING_REPORTERS,
    reporterCount,
    requiredReporters: MIN_CORROBORATING_REPORTERS,
    incidentCount: new Set(counted.map(incidentKeyOf)).size,
    windowDays: CORROBORATION_WINDOW_DAYS,
    relatedReportIds: counted.map((r) => String(r._id)).filter((id) => id !== String(report._id)),
  };
}
