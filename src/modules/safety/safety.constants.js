export const REPORT_TARGET_TYPES = Object.freeze({
  USER: 'user',
  MESSAGE: 'message',
  PLAYDATE: 'playdate',
});

export const REPORT_STATUS = Object.freeze({
  PENDING: 'pending',
  REVIEWING: 'reviewing',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
});

export const REPORT_SEVERITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const REPORT_CATEGORIES = Object.freeze({
  HARASSMENT: 'harassment',
  INAPPROPRIATE_CONTENT: 'inappropriate_content',
  SPAM: 'spam',
  FAKE_PROFILE: 'fake_profile',
  CHILD_SAFETY: 'child_safety',
  NO_SHOW: 'no_show',
  OTHER: 'other',
});

export const CATEGORY_TO_SEVERITY = Object.freeze({
  [REPORT_CATEGORIES.CHILD_SAFETY]: REPORT_SEVERITY.CRITICAL,
  [REPORT_CATEGORIES.HARASSMENT]: REPORT_SEVERITY.HIGH,
  [REPORT_CATEGORIES.INAPPROPRIATE_CONTENT]: REPORT_SEVERITY.HIGH,
  [REPORT_CATEGORIES.FAKE_PROFILE]: REPORT_SEVERITY.MEDIUM,
  [REPORT_CATEGORIES.NO_SHOW]: REPORT_SEVERITY.LOW,
  [REPORT_CATEGORIES.SPAM]: REPORT_SEVERITY.LOW,
  [REPORT_CATEGORIES.OTHER]: REPORT_SEVERITY.MEDIUM,
});

export const OVERDUE_THRESHOLDS_HOURS = Object.freeze({
  [REPORT_SEVERITY.CRITICAL]: 2,
  [REPORT_SEVERITY.HIGH]: 24,
  [REPORT_SEVERITY.MEDIUM]: 24,
  [REPORT_SEVERITY.LOW]: 24,
});

export const REPORT_ACTION_TYPES = Object.freeze({
  WARN: 'warn',
  DELETE_MESSAGE: 'delete_message',
  CANCEL_PLAYDATE: 'cancel_playdate',
  SUSPEND: 'suspend',
  BAN: 'ban',
  DISMISS: 'dismiss',
  NO_ACTION: 'no_action',
});

export const REPORT_RESOLUTION_TYPES = Object.freeze({
  ACTION_TAKEN: 'action_taken',
  NO_ACTION: 'no_action',
  DISMISSED: 'dismissed',
});

export const REPORT_HISTORY_EVENT_TYPES = Object.freeze({
  STATUS_CHANGE: 'status_change',
  CLAIM: 'claim',
  TAKEOVER: 'takeover',
  SEVERITY_CHANGE: 'severity_change',
  ACTION_APPLIED: 'action_applied',
  REOPEN: 'reopen',
  SENTINEL_ASSESSED: 'sentinel_assessed',
  AUTO_SHIELDED: 'auto_shielded',
  POLICY_OVERRIDDEN: 'policy_overridden',
  ACTION_FAILED: 'action_failed',
  // An admin unlocked the account before the end of the sanction this report decided
  SANCTION_LIFTED: 'sanction_lifted',
});

// What an admin can apply from POST /admin/reports/:id/action (closing a report has its own endpoint)
export const REPORT_SANCTION_TYPES = Object.freeze([
  REPORT_ACTION_TYPES.WARN,
  REPORT_ACTION_TYPES.DELETE_MESSAGE,
  REPORT_ACTION_TYPES.CANCEL_PLAYDATE,
  REPORT_ACTION_TYPES.SUSPEND,
  REPORT_ACTION_TYPES.BAN,
]);

// Sanctions on the whole account: open reports against the same user can be closed together with them
export const REPORT_ACCOUNT_SANCTION_TYPES = Object.freeze([REPORT_ACTION_TYPES.SUSPEND, REPORT_ACTION_TYPES.BAN]);

export const REPORT_OPEN_STATUSES = Object.freeze([REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING]);
export const REPORT_CLOSED_STATUSES = Object.freeze([REPORT_STATUS.RESOLVED, REPORT_STATUS.DISMISSED]);

// Queue order: the higher, the sooner
export const REPORT_SEVERITY_WEIGHTS = Object.freeze({
  [REPORT_SEVERITY.CRITICAL]: 4,
  [REPORT_SEVERITY.HIGH]: 3,
  [REPORT_SEVERITY.MEDIUM]: 2,
  [REPORT_SEVERITY.LOW]: 1,
});

export const REPORT_SORTS = Object.freeze({
  QUEUE: 'queue', // Severity, then oldest first
  NEWEST: 'newest',
  OLDEST: 'oldest',
});

// Generic reason given to the reported user, never the words of the reporter
export const REPORT_CATEGORY_NOTICES = Object.freeze({
  [REPORT_CATEGORIES.HARASSMENT]: 'quấy rối hoặc đe dọa người khác',
  [REPORT_CATEGORIES.INAPPROPRIATE_CONTENT]: 'nội dung không phù hợp',
  [REPORT_CATEGORIES.SPAM]: 'gửi tin rác',
  [REPORT_CATEGORIES.FAKE_PROFILE]: 'hồ sơ không xác thực',
  [REPORT_CATEGORIES.CHILD_SAFETY]: 'vi phạm quy tắc an toàn trẻ em',
  [REPORT_CATEGORIES.NO_SHOW]: 'không tham gia cuộc hẹn đã xác nhận',
  [REPORT_CATEGORIES.OTHER]: 'vi phạm Quy chuẩn Cộng đồng',
});

// Conclusion of the Sentinel AI on a report. Only a violation gets AI-recommended sanctions.
export const SENTINEL_VERDICTS = Object.freeze({
  VIOLATION: 'violation',
  NO_VIOLATION: 'no_violation', // misunderstanding, false or retaliatory report
  UNCLEAR: 'unclear', // not enough to conclude (also a failed AI call or an assessment made before verdicts)
});

// Vietnamese labels of sanctions, used in notes and history entries the admin reads
export const REPORT_ACTION_LABELS = Object.freeze({
  [REPORT_ACTION_TYPES.WARN]: 'cảnh cáo',
  [REPORT_ACTION_TYPES.DELETE_MESSAGE]: 'xóa tin nhắn',
  [REPORT_ACTION_TYPES.CANCEL_PLAYDATE]: 'hủy buổi hẹn',
  [REPORT_ACTION_TYPES.SUSPEND]: 'tạm đình chỉ tài khoản',
  [REPORT_ACTION_TYPES.BAN]: 'khóa vĩnh viễn',
});

/** "warn, suspend" -> "cảnh cáo, tạm đình chỉ tài khoản" */
export const toActionLabels = (types = []) =>
  types.map((type) => REPORT_ACTION_LABELS[type] || type).join(', ');

export const RISK_LEVEL_LABELS = Object.freeze({
  high: 'CAO',
  medium: 'TRUNG BÌNH',
  low: 'THẤP',
});

export const REPORT_LIMITS = Object.freeze({
  MAX_EVIDENCE_URLS: 5,
  // A reporter can report the same parent at most once per window
  DUPLICATE_WINDOW_MS: 24 * 60 * 60 * 1000,
});

// Stored when the client sends no block reason (shown on the blocked users list)
export const DEFAULT_BLOCK_REASON = 'Không muốn tiếp tục liên lạc';
