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
