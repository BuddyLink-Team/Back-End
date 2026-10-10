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

export const REPORT_LIMITS = Object.freeze({
  MAX_EVIDENCE_URLS: 5,
  // A reporter can report the same parent at most once per window
  DUPLICATE_WINDOW_MS: 24 * 60 * 60 * 1000,
});
