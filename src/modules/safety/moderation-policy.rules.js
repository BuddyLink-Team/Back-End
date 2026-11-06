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
      "Rule 1.1: Zero tolerance child safety violation (Grooming, Predatory behavior, Exploitation)",
    description:
      "Any violation concerning child safety results in immediate permanent ban.",
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
    clause: "Rule 2.1: Harassment, bullying, and hostile communication",
    description: "Verbal attacks, threats, or severe repetitive harassment.",
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
    clause: "Rule 3.1: Inappropriate text, media, or vulgar language",
    description: "Adult content, profane language, or disturbing imagery.",
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
      "Rule 4.1: Impersonation, deceptive identity, or misleading family profile",
    description: "Creating fake accounts or impersonating other parents.",
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
      "Rule 5.1: Commercial spam, unsolicited solicitation, or repetitive junk",
    description: "Sending bulk sales pitches or unsolicited links.",
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
    clause: "Rule 6.1: Repeated confirmed playdate abandonment without notice",
    description: "Failing to attend confirmed playdates repeatedly.",
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
    clause: "Rule 7.1: General Community Guidelines violation",
    description:
      "Other disruptive behaviors not covered by specific categories.",
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
      clause: "Rule 0.1: Critical Severity Emergency Escalate",
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
 * @param {string} actionType
 * @param {Object} policyResult
 * @returns {{ isOverride: boolean, reasonRequired: boolean }}
 */
export const checkActionPolicyCompliance = (actionType, policyResult) => {
  if (!policyResult || !policyResult.allowedActionTypes) {
    return { isOverride: false, reasonRequired: false };
  }
  const isAllowed = policyResult.allowedActionTypes.includes(actionType);
  return {
    isOverride: !isAllowed,
    reasonRequired: !isAllowed,
  };
};
