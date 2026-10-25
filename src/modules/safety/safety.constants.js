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

export const REPORT_CATEGORIES = Object.freeze({
  HARASSMENT: 'harassment',
  INAPPROPRIATE_CONTENT: 'inappropriate_content',
  SPAM: 'spam',
  FAKE_PROFILE: 'fake_profile',
  CHILD_SAFETY: 'child_safety',
  NO_SHOW: 'no_show',
  OTHER: 'other',
});

export const REPORT_LIMITS = Object.freeze({
  MAX_EVIDENCE_URLS: 5,
  // A reporter can report the same parent at most once per window
  DUPLICATE_WINDOW_MS: 24 * 60 * 60 * 1000,
});
