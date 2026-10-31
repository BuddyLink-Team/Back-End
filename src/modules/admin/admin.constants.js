/**
 * Whether a child profile can be seen in Discovery, and why not.
 * Checked in this order: the first reason that applies wins.
 */
export const CHILD_VISIBILITY = Object.freeze({
  ARCHIVED: 'archived', // Deleted by the parent
  PARENT_LOCKED: 'parent_locked', // Parent account locked by an admin
  PLAN_LOCKED: 'plan_locked', // Over the Free plan child limit
  PARENT_HIDDEN: 'parent_hidden', // Parent hid their profile
  VISIBLE: 'visible',
});

export const LOGIN_METHODS = Object.freeze({
  PASSWORD: 'password',
  GOOGLE: 'google',
});

export const ADMIN_SEARCH_MAX_LENGTH = 100;

// Reason an admin gives when cancelling a playdate or removing a connection
export const ADMIN_REASON_MAX_LENGTH = 500;

// Revenue overview without a date range: this many calendar months back, current month included
export const REVENUE_DEFAULT_MONTHS = 6;

// Dashboard analytics: default range (today included), longest range, and how each period is grouped
export const ANALYTICS_DEFAULT_DAYS = 30;
export const ANALYTICS_MAX_RANGE_DAYS = 366;
export const ANALYTICS_GROUP_BY = Object.freeze({
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
});
// %G-W%V: the ISO year goes with the ISO week (29/12/2025 is 2026-W01)
export const ANALYTICS_DATE_FORMATS = Object.freeze({
  [ANALYTICS_GROUP_BY.DAY]: '%Y-%m-%d',
  [ANALYTICS_GROUP_BY.WEEK]: '%G-W%V',
  [ANALYTICS_GROUP_BY.MONTH]: '%Y-%m',
});
export const ANALYTICS_TOP_AI_PARENTS = 5;

// Error codes of the report moderation endpoints
export const ADMIN_REPORT_ERRORS = Object.freeze({
  REPORT_NOT_FOUND: 'REPORT_NOT_FOUND',
  REPORT_ALREADY_CLOSED: 'REPORT_ALREADY_CLOSED',
  REPORTED_USER_NOT_FOUND: 'REPORTED_USER_NOT_FOUND',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INVALID_RESOLUTION: 'INVALID_RESOLUTION',
  INVALID_ACTION_TYPE: 'INVALID_ACTION_TYPE',
  ACTION_ALREADY_APPLIED: 'ACTION_ALREADY_APPLIED',
  ACTIONS_REQUIRED_FOR_RESOLVE: 'ACTIONS_REQUIRED_FOR_RESOLVE',
  RELATED_REPORTS_REQUIRE_SANCTION: 'RELATED_REPORTS_REQUIRE_SANCTION',
  DURATION_DAYS_REQUIRED: 'DURATION_DAYS_REQUIRED',
  TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
});

export const ADMIN_NOTIFICATION_CATEGORIES = Object.freeze({
  USERS: 'users',
  PAYMENTS: 'payments',
  PLAYDATES: 'playdates',
  CONNECTIONS: 'connections',
  SAFETY: 'safety',
  SYSTEM: 'system',
});

export const ADMIN_NOTIFICATION_SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
});

// "All" option of the category and severity filters
export const ADMIN_NOTIFICATION_FILTER_ALL = 'all';

export const ADMIN_NOTIFICATION_TTL_SECONDS = 90 * 24 * 60 * 60;
// A public webhook can fail any number of times: one notification per window is enough
export const ADMIN_NOTIFICATION_GATEWAY_ERROR_WINDOW_MS = 5 * 60 * 1000;
export const ADMIN_NOTIFICATION_STREAM_RETRY_MS = 5000;

export const ADMIN_SOCKET_NAMESPACE = '/admin';
export const ADMIN_SOCKET_ROOM = 'admins';
export const ADMIN_SOCKET_EVENTS = Object.freeze({
  NOTIFICATION_NEW: 'admin:notification:new',
  UNREAD_COUNT: 'admin:notification:unread-count',
});
