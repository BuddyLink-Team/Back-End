import env from '../../config/env.js';
import safetyRepository from './safety.repository.js';
import parentService from '../parent/parent.service.js';
import logger from '../../shared/logger/index.js';
import {
  REPORT_ACCOUNT_SANCTION_TYPES,
  REPORT_CATEGORY_NOTICES,
  REPORT_HISTORY_EVENT_TYPES,
} from './safety.constants.js';

// Kind of lock of an account, whether or not it is still active (null-safe on documents and plain objects)
const lockKindOf = (user) => (user?.banReason ? 'banned' : user?.suspensionUntil ? 'suspended' : 'locked');
const lockTypeOf = (user) => (user?.isActive !== false ? null : lockKindOf(user));

const formatNoticeDate = (date) => new Date(date).toLocaleString('vi-VN', { timeZone: env.APP_TIMEZONE });

/**
 * Where the lock of an account comes from: the latest report whose sanction suspended or banned it.
 * null when the account is active, or locked by hand from the users page (no report behind it).
 * Nothing is stored for it: it is read from the reports.
 * @param {{ _id: *, isActive?: boolean, banReason?: string|null, suspensionUntil?: Date|null }} user
 * @returns {Promise<{ lockType: 'suspended'|'banned', suspensionUntil: Date|null, reason: string|null,
 *   reportId: *, decidedAt: Date }|null>}
 */
export const getLockSource = async (user, { isRefused = false } = {}) => {
  // isRefused: the account was just refused, whatever its loaded state says
  const lockType = isRefused ? lockKindOf(user) : lockTypeOf(user);
  if (!lockType || lockType === 'locked') return null;
  const parent = await parentService.getParentByUserId(user._id);
  const action = parent
    ? await safetyRepository.findLatestLockAction(parent._id, REPORT_ACCOUNT_SANCTION_TYPES)
    : null;
  if (!action) return null;
  return {
    lockType,
    suspensionUntil: lockType === 'suspended' ? user.suspensionUntil : null,
    reason: REPORT_CATEGORY_NOTICES[action.category] || null,
    reportId: action.reportId,
    reportStatus: action.status,
    decidedAt: action.performedAt,
  };
};

/**
 * What a locked parent is told when signing in is refused: suspended until a date, banned for good, or
 * locked by an admin. The reason is the kind of violation of the report that locked the account, in the
 * same generic words as the sanction notice (never the admin's own notes).
 * @param {{ _id: *, banReason?: string|null, suspensionUntil?: Date|null }} user
 * @returns {Promise<{ lockType: 'suspended'|'banned'|'locked', suspensionUntil: Date|null, reason: string|null }>}
 */
export const getAccountLockDetails = async (user) => {
  const lockType = lockKindOf(user);
  let reason = null;
  if (lockType !== 'locked') {
    try {
      reason = (await getLockSource(user, { isRefused: true }))?.reason || null;
    } catch (err) {
      // The refusal is still answered, without the reason
      logger.warn(`[AccountLock] Lock reason lookup failed for user=${user._id}: ${err.message}`);
    }
  }
  return {
    lockType,
    suspensionUntil: lockType === 'suspended' ? user.suspensionUntil : null,
    reason,
  };
};

/**
 * The admin lifted a sanction before its end: logged on the report that decided it
 * @param {{ source: Object, adminUserId: *, reason: string }} param0 - source from getLockSource
 */
export const recordSanctionLifted = async ({ source, adminUserId, reason }) => {
  const what =
    source.lockType === 'banned'
      ? 'án khóa vĩnh viễn'
      : `án đình chỉ đến ${formatNoticeDate(source.suspensionUntil)}`;
  await safetyRepository.pushReportHistory(source.reportId, {
    eventType: REPORT_HISTORY_EVENT_TYPES.SANCTION_LIFTED,
    fromStatus: source.reportStatus,
    toStatus: source.reportStatus,
    by: adminUserId,
    actorType: 'admin',
    at: new Date(),
    note: `Admin mở khóa tài khoản sớm (${what}) — Lý do: ${reason}`,
    metadata: { lockType: source.lockType, suspensionUntil: source.suspensionUntil, reason },
  });
};

export default getAccountLockDetails;
