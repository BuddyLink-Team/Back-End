import {
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  REPORT_ACTION_TYPES,
} from "./safety.constants.js";

/**
 * Progressive discipline strike thresholds and policy rules for BuddyLink.
 * Ensures objective, deterministic sanction recommendations across both AI and Admin.
 */

export const POLICY_STRIKE_LEVELS = Object.freeze({
  FIRST: 1,
  SECOND: 2,
  THIRD_PLUS: 3,
});

/**
 * Standard Sanction Matrix.
 * Maps (Category, Severity, StrikeLevel) -> Standard recommended actions and allowed action types.
 */
export const SANCTION_POLICY_MATRIX = Object.freeze({
  [REPORT_CATEGORIES.CHILD_SAFETY]: {
    clause:
      "Điều 1.1: Không khoan nhượng với vi phạm an toàn trẻ em (dụ dỗ, hành vi săn mồi, bóc lột)",
    description:
      "Mọi vi phạm liên quan đến an toàn trẻ em đều bị khóa tài khoản vĩnh viễn ngay lập tức.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.BAN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.BAN,
      ],
      suggestedSeverity: REPORT_SEVERITY.CRITICAL,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.BAN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.BAN,
      ],
      suggestedSeverity: REPORT_SEVERITY.CRITICAL,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.BAN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.BAN,
      ],
      suggestedSeverity: REPORT_SEVERITY.CRITICAL,
    },
  },

  [REPORT_CATEGORIES.HARASSMENT]: {
    clause: "Điều 2.1: Quấy rối, bắt nạt và giao tiếp thù địch",
    description: "Công kích bằng lời, đe dọa hoặc quấy rối nghiêm trọng lặp lại.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.WARN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.WARN,
      ],
      suggestedSeverity: REPORT_SEVERITY.HIGH,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 7 },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.SUSPEND,
      ],
      suggestedSeverity: REPORT_SEVERITY.HIGH,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.BAN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.BAN,
      ],
      suggestedSeverity: REPORT_SEVERITY.CRITICAL,
    },
  },

  [REPORT_CATEGORIES.INAPPROPRIATE_CONTENT]: {
    clause: "Điều 3.1: Văn bản, hình ảnh không phù hợp hoặc ngôn từ thô tục",
    description: "Nội dung người lớn, ngôn từ tục tĩu hoặc hình ảnh gây khó chịu.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.WARN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.WARN,
      ],
      suggestedSeverity: REPORT_SEVERITY.HIGH,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 14 },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.SUSPEND,
      ],
      suggestedSeverity: REPORT_SEVERITY.HIGH,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.BAN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.BAN,
      ],
      suggestedSeverity: REPORT_SEVERITY.CRITICAL,
    },
  },

  [REPORT_CATEGORIES.FAKE_PROFILE]: {
    clause:
      "Điều 4.1: Mạo danh, giả danh hoặc hồ sơ gia đình sai sự thật",
    description: "Tạo tài khoản giả hoặc mạo danh phụ huynh khác.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [{ type: REPORT_ACTION_TYPES.WARN }],
      allowedTypes: [REPORT_ACTION_TYPES.WARN],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [{ type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 7 }],
      allowedTypes: [REPORT_ACTION_TYPES.SUSPEND],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [{ type: REPORT_ACTION_TYPES.BAN }],
      allowedTypes: [REPORT_ACTION_TYPES.BAN],
      suggestedSeverity: REPORT_SEVERITY.HIGH,
    },
  },

  [REPORT_CATEGORIES.SPAM]: {
    clause:
      "Điều 5.1: Quảng cáo, chào mời không mong muốn hoặc tin rác lặp lại",
    description: "Gửi hàng loạt tin chào hàng hoặc liên kết không mong muốn.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.WARN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.WARN,
      ],
      suggestedSeverity: REPORT_SEVERITY.LOW,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.WARN },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.WARN,
      ],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [
        { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
        { type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 3 },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.DELETE_MESSAGE,
        REPORT_ACTION_TYPES.SUSPEND,
      ],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
  },

  [REPORT_CATEGORIES.NO_SHOW]: {
    clause: "Điều 6.1: Nhiều lần vắng mặt tại buổi hẹn đã xác nhận mà không báo trước",
    description: "Nhiều lần không tham gia buổi hẹn đã xác nhận.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [
        { type: REPORT_ACTION_TYPES.WARN },
        { type: REPORT_ACTION_TYPES.CANCEL_PLAYDATE },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.WARN,
        REPORT_ACTION_TYPES.CANCEL_PLAYDATE,
      ],
      suggestedSeverity: REPORT_SEVERITY.LOW,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [
        { type: REPORT_ACTION_TYPES.WARN },
        { type: REPORT_ACTION_TYPES.CANCEL_PLAYDATE },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.WARN,
        REPORT_ACTION_TYPES.CANCEL_PLAYDATE,
      ],
      suggestedSeverity: REPORT_SEVERITY.LOW,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [
        { type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 3 },
        { type: REPORT_ACTION_TYPES.CANCEL_PLAYDATE },
      ],
      allowedTypes: [
        REPORT_ACTION_TYPES.SUSPEND,
        REPORT_ACTION_TYPES.CANCEL_PLAYDATE,
      ],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
  },

  [REPORT_CATEGORIES.OTHER]: {
    clause: "Điều 7.1: Vi phạm chung Quy chuẩn Cộng đồng",
    description:
      "Các hành vi gây ảnh hưởng khác ngoài những danh mục cụ thể.",
    [POLICY_STRIKE_LEVELS.FIRST]: {
      actions: [{ type: REPORT_ACTION_TYPES.WARN }],
      allowedTypes: [REPORT_ACTION_TYPES.WARN],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
    [POLICY_STRIKE_LEVELS.SECOND]: {
      actions: [{ type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 7 }],
      allowedTypes: [REPORT_ACTION_TYPES.SUSPEND],
      suggestedSeverity: REPORT_SEVERITY.MEDIUM,
    },
    [POLICY_STRIKE_LEVELS.THIRD_PLUS]: {
      actions: [{ type: REPORT_ACTION_TYPES.SUSPEND, durationDays: 30 }],
      allowedTypes: [REPORT_ACTION_TYPES.SUSPEND],
      suggestedSeverity: REPORT_SEVERITY.HIGH,
    },
  },
});

/**
 * Determine the strike level based on prior sanction count.
 * @param {number} priorCount
 * @returns {number}
 */
export const toStrikeLevel = (priorCount = 0) => {
  if (priorCount <= 0) return POLICY_STRIKE_LEVELS.FIRST;
  if (priorCount === 1) return POLICY_STRIKE_LEVELS.SECOND;
  return POLICY_STRIKE_LEVELS.THIRD_PLUS;
};

/**
 * Calculate the standard policy-guided sanction for a report.
 * @param {string} category
 * @param {string} severity
 * @param {number} priorSanctionsCount
 * @returns {{
 *   strikeCount: number,
 *   strikeLevel: number,
 *   clause: string,
 *   suggestedSeverity: string,
 *   standardActions: Array<{ type: string, durationDays?: number, reason?: string }>,
 *   allowedActionTypes: string[],
 * }}
 */
export const calculatePolicySanction = (
  category,
  severity,
  priorSanctionsCount = 0,
  targetType = null,
) => {
  const effectiveCategory = SANCTION_POLICY_MATRIX[category]
    ? category
    : REPORT_CATEGORIES.OTHER;
  const strikeLevel = toStrikeLevel(priorSanctionsCount);
  const strikeCount = priorSanctionsCount + 1; // Current incident is (prior + 1)-th strike

  const categoryPolicy = SANCTION_POLICY_MATRIX[effectiveCategory];
  const rule = categoryPolicy[strikeLevel];

  const filterByTarget = (actions, allowedTypes) => {
    if (!targetType) return { actions, allowedTypes };
    const isActionCompatible = (type) => {
      if (type === REPORT_ACTION_TYPES.DELETE_MESSAGE && targetType !== "message") return false;
      if (type === REPORT_ACTION_TYPES.CANCEL_PLAYDATE && targetType !== "playdate") return false;
      return true;
    };
    const filteredActions = actions.filter((a) => isActionCompatible(a.type));
    const filteredAllowed = allowedTypes.filter(isActionCompatible);
    return {
      actions: filteredActions.length > 0 ? filteredActions : [{ type: REPORT_ACTION_TYPES.WARN }],
      allowedTypes: filteredAllowed.length > 0 ? filteredAllowed : [REPORT_ACTION_TYPES.WARN],
    };
  };

  // If severity was manually upgraded to CRITICAL by human/Sentinel, enforce zero tolerance
  if (
    severity === REPORT_SEVERITY.CRITICAL &&
    effectiveCategory !== REPORT_CATEGORIES.CHILD_SAFETY
  ) {
    const baseActions = [
      { type: REPORT_ACTION_TYPES.DELETE_MESSAGE },
      { type: REPORT_ACTION_TYPES.BAN },
    ];
    const baseAllowed = [
      REPORT_ACTION_TYPES.DELETE_MESSAGE,
      REPORT_ACTION_TYPES.BAN,
    ];
    const filtered = filterByTarget(baseActions, baseAllowed);
    return {
      strikeCount,
      strikeLevel,
      clause: "Điều 0.1: Mức nghiêm trọng — chuyển xử lý khẩn cấp",
      description: categoryPolicy.description,
      suggestedSeverity: REPORT_SEVERITY.CRITICAL,
      standardActions: filtered.actions,
      allowedActionTypes: filtered.allowedTypes,
    };
  }

  const filtered = filterByTarget(rule.actions, rule.allowedTypes);
  return {
    strikeCount,
    strikeLevel,
    clause: categoryPolicy.clause,
    description: categoryPolicy.description,
    suggestedSeverity: rule.suggestedSeverity,
    standardActions: filtered.actions,
    allowedActionTypes: filtered.allowedTypes,
  };
};

/**
 * Check whether an admin action requires a policy override justification.
 * Out of matrix, or a suspension whose length differs from the standard one, is an override.
 * @param {string} actionType
 * @param {Object|null} policyResult - null when the report has no Sentinel assessment (no matrix applies)
 * @param {number|string|null} [durationDays] - Suspension length chosen by the admin
 * @returns {{ isOverride: boolean, reasonRequired: boolean }}
 */
export const checkActionPolicyCompliance = (actionType, policyResult, durationDays = null) => {
  if (!policyResult || !policyResult.allowedActionTypes) {
    return { isOverride: false, reasonRequired: false };
  }
  const isAllowed = policyResult.allowedActionTypes.includes(actionType);
  const standard = (policyResult.standardActions || []).find((a) => a.type === actionType);
  const isDurationMismatch = Boolean(
    isAllowed &&
      actionType === REPORT_ACTION_TYPES.SUSPEND &&
      standard?.durationDays &&
      durationDays !== null &&
      durationDays !== undefined &&
      Number(durationDays) !== Number(standard.durationDays)
  );
  const isOverride = !isAllowed || isDurationMismatch;
  return { isOverride, reasonRequired: isOverride };
};
