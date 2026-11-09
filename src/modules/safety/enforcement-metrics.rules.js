/**
 * Pure business rules for computing 3-Factor Automated Enforcement metrics:
 * 1. Velocity Analysis (windowed report volume and unique reporters)
 * 2. Reporter Credibility (reporter history and account age)
 * 3. Incident Pattern (independent vs suspected coordinated brigading)
 */

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
  let label = 'Đáng tin cậy — Lịch sử báo cáo tốt, không có dấu hiệu phối hợp report ảo';

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
    'Sự việc đơn lẻ từ phụ huynh báo cáo trực tiếp, không có dấu hiệu nhiều tài khoản phối hợp report.';

  if (uniqueReportersCount >= 2) {
    if (!hasDirectTargets && distinctTargetMessages.size === 0 && uniqueReportersCount >= 3) {
      coordinatedSuspected = true;
      isIndependentIncidents = false;
      incidentPattern = `Cảnh báo: Ghi nhận ${uniqueReportersCount} tài khoản cùng report trong 30 phút nhưng thiếu bằng chứng trực tiếp (cần kiểm tra khả năng report phối hợp/brigading).`;
    } else {
      coordinatedSuspected = false;
      isIndependentIncidents = true;
      incidentPattern = `Ghi nhận ${reportsIn30Min.length} báo cáo từ ${uniqueReportersCount} phụ huynh độc lập với ngữ cảnh tương tác riêng biệt (không phải report giả phối hợp).`;
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

  const shouldApplyTempRestriction = Boolean(
    velocity.isHighVelocityRisk ||
    policy.requiresTemporaryRestriction ||
    (report.severity === 'critical' && reportsIn30Min.length >= 2)
  );

  const steps = [
    'Giám sát phòng thủ tự động (Auto-Shield)',
    `Cửa sổ 30 phút: ${velocity.reportsIn30MinCount} báo cáo từ ${velocity.uniqueReportersCount} người báo cáo`,
    `Độ tin cậy người báo cáo: ${credibility.label}`,
    pattern.incidentPattern,
  ];

  if (shouldApplyTempRestriction) {
    steps.push('Tự động kích hoạt hạn chế nhắn tin tạm thời (tối đa 72h) để bảo vệ an toàn cộng đồng');
  }

  return {
    reportsReceived: velocity.reportsIn30MinCount,
    timeWindow: '30 min',
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
            'Chặn tạo lời mời Playdate mới trong thời gian hạn chế',
          ]
        : [],
    },
  };
}

