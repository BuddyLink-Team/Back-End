import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import authService from '../auth/auth.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import connectionService from '../connection/connection.service.js';
import playdateService from '../playdate/playdate.service.js';
import safetyService from '../safety/safety.service.js';
import chatService from '../chat/chat.service.js';
import notificationService from '../notification/notification.service.js';
import Report from '../safety/report.model.js';
import User from '../user/user.model.js';
import Parent from '../parent/parent.model.js';
import { getIO } from '../../config/socket.js';
import aiAssistantService from '../ai-assistant/ai-assistant.service.js';
import adminNotificationService from './admin-notification.service.js';
import env from '../../config/env.js';
import AppError from '../../shared/exceptions/app-error.js';
import { USER_ROLES, PAGINATION } from '../../shared/constants/index.js';
import { getZonedParts, getZonedDayRange } from '../../shared/helpers/date.helper.js';
import {
  ADMIN_NOTIFICATION_FILTER_ALL,
  ANALYTICS_DATE_FORMATS,
  ANALYTICS_DEFAULT_DAYS,
  ANALYTICS_GROUP_BY,
  ANALYTICS_TOP_AI_PARENTS,
  CHILD_VISIBILITY,
  LOGIN_METHODS,
  REVENUE_DEFAULT_MONTHS,
} from './admin.constants.js';
import { emitUserEvent, USER_EVENTS } from '../user/user.events.js';
import {
  REPORT_STATUS,
  REPORT_SEVERITY,
  REPORT_ACTION_TYPES,
  REPORT_RESOLUTION_TYPES,
  REPORT_HISTORY_EVENT_TYPES,
  OVERDUE_THRESHOLDS_HOURS,
} from '../safety/safety.constants.js';
import {
  AdminUserListItemDTO,
  AdminUserDetailDTO,
  AdminChildListItemDTO,
  AdminChildDetailDTO,
  AdminPlaydateDTO,
  AdminConnectionDTO,
  AdminPlanDTO,
  AdminSubscriptionDTO,
  AdminTransactionDTO,
  AdminReportListItemDTO,
  AdminReportDetailDTO,
} from './admin.dto.js';

// Query string values arrive as strings ('true' / 'false'); absent means "no filter"
const toOptionalBoolean = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true';
};

const toOptionalInt = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = parseInt(value, 10);
  return Number.isInteger(number) ? number : undefined;
};

const toPaging = ({ page, limit }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || PAGINATION.DEFAULT_PAGE);
  const limitNum = Math.min(PAGINATION.MAX_LIMIT, Math.max(1, parseInt(limit, 10) || PAGINATION.DEFAULT_LIMIT));
  return { page: pageNum, limit: limitNum };
};

// Ids in both lists; a null list does not restrict
const intersectIds = (first, second) => {
  if (!first) return second;
  if (!second) return first;
  const secondSet = new Set(second.map(String));
  return first.filter((id) => secondSet.has(String(id)));
};

const toPagination = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

// Query date as an instant. A 'YYYY-MM-DD' day is taken in APP_TIMEZONE (payments are instants):
// its start for a lower bound, its end for an upper bound, so the whole toDate day is included
const toDateBound = (value, { endOfDay = false } = {}) => {
  if (!value) return undefined;
  if (typeof value === 'string' && value.length === 10) {
    const { start, end } = getZonedDayRange(value);
    return endOfDay ? end : start;
  }
  return new Date(value);
};

const toPercent = (part, whole) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0);

// Every 'YYYY-MM' from the month of `from` to the month of `to`, in APP_TIMEZONE
const listMonths = (from, to) => {
  const end = getZonedParts(to);
  let { year, month } = getZonedParts(from);
  const months = [];
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
};

const checkIsOverdue = (report) => {
  if (![REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING].includes(report.status)) {
    return false;
  }
  const thresholdHours = OVERDUE_THRESHOLDS_HOURS[report.severity] || 24;
  const elapsedMs = Date.now() - new Date(report.createdAt).getTime();
  return elapsedMs > thresholdHours * 60 * 60 * 1000;
};

const calculateKpi = (value, previousValue) => {
  const changePercent =
    previousValue === 0
      ? null
      : Number((((value - previousValue) / previousValue) * 100).toFixed(1));
  return {
    value,
    previousValue,
    changePercent,
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const pad2 = (value) => String(value).padStart(2, '0');

// ISO 8601 week of a calendar day: the week belongs to the year of its Thursday
const getIsoWeek = (utcDay) => {
  const thursday = new Date(utcDay);
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstWeekThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstWeekThursday.setUTCDate(firstWeekThursday.getUTCDate() - ((firstWeekThursday.getUTCDay() + 6) % 7) + 3);
  return { isoYear, week: 1 + Math.round((thursday - firstWeekThursday) / (7 * DAY_MS)) };
};

// Key (same as the MongoDB ANALYTICS_DATE_FORMATS) and display label of the period a calendar day falls in
const toAnalyticsPeriod = (utcDay, groupBy) => {
  const year = utcDay.getUTCFullYear();
  const month = pad2(utcDay.getUTCMonth() + 1);
  const day = pad2(utcDay.getUTCDate());
  if (groupBy === ANALYTICS_GROUP_BY.MONTH) {
    return { period: `${year}-${month}`, label: `T${utcDay.getUTCMonth() + 1}/${year}` };
  }
  if (groupBy === ANALYTICS_GROUP_BY.WEEK) {
    const { isoYear, week } = getIsoWeek(utcDay);
    return { period: `${isoYear}-W${pad2(week)}`, label: `Tuần ${week}/${isoYear}` };
  }
  return { period: `${year}-${month}-${day}`, label: `${day}/${month}` };
};

// Every period touched by a range, in APP_TIMEZONE, in order: those without data still show as 0
const listAnalyticsPeriods = (start, end, groupBy) => {
  const first = getZonedParts(start);
  const last = getZonedParts(end);
  const lastDayMs = Date.UTC(last.year, last.month - 1, last.day);
  const periods = new Map();
  for (let dayMs = Date.UTC(first.year, first.month - 1, first.day); dayMs <= lastDayMs; dayMs += DAY_MS) {
    const period = toAnalyticsPeriod(new Date(dayMs), groupBy);
    if (!periods.has(period.period)) periods.set(period.period, period);
  }
  return [...periods.values()];
};

// Range of the analytics: both bounds are whole days in APP_TIMEZONE, by default the last days up to today
const toAnalyticsRange = ({ fromDate, toDate }) => {
  const today = getZonedParts(new Date());
  const end =
    toDateBound(toDate, { endOfDay: true }) ||
    getZonedDayRange(`${today.year}-${pad2(today.month)}-${pad2(today.day)}`).end;
  const start = toDateBound(fromDate);
  if (start) return { start, end };

  const lastDay = getZonedParts(end);
  const firstDay = new Date(Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day - (ANALYTICS_DEFAULT_DAYS - 1)));
  return { start: getZonedDayRange(firstDay.toISOString().slice(0, 10)).start, end };
};

const toCountByPeriod = (rows) => new Map(rows.map((row) => [row.period, row.count]));

class AdminService {
  /**
   * Get paginated parent accounts with their profile, active children count and plan in effect
   * @param {{ search?: string, isActive?: string, isVerified?: string, isPremium?: string, page?: string, limit?: string }} queryParams
   */
  async getUsers(queryParams) {
    const paging = toPaging(queryParams);
    const search = queryParams.search?.trim() || '';
    const isVerified = toOptionalBoolean(queryParams.isVerified);
    const isPremium = toOptionalBoolean(queryParams.isPremium);

    // The search covers the account (email, phone) and the parent profile (name)
    const [verifiedUserIds, nameMatchUserIds, premiumUserIds] = await Promise.all([
      isVerified === undefined ? null : parentService.findUserIdsByProfile({ isVerifiedParent: isVerified }),
      search ? parentService.findUserIdsByProfile({ search }) : [],
      isPremium === undefined ? null : this._getPremiumUserIds(),
    ]);

    const { items: users, total } = await userService.getUsersPageByRole({
      role: USER_ROLES.PARENT,
      isActive: toOptionalBoolean(queryParams.isActive),
      restrictToIds: intersectIds(verifiedUserIds, isPremium === true ? premiumUserIds : null),
      excludeIds: isPremium === false ? premiumUserIds : null,
      search,
      searchMatchIds: nameMatchUserIds,
      ...paging,
    });

    const parents = await parentService.getParentsByUserIds(users.map((user) => user._id));
    const parentByUserId = new Map(parents.map((parent) => [parent.userId.toString(), parent]));
    const parentIds = parents.map((parent) => parent._id);

    const [childrenCounts, subscriptions] = await Promise.all([
      childService.countActiveChildrenByParentIds(parentIds),
      subscriptionService.getSubscriptionsByParentIds(parentIds),
    ]);
    const subscriptionByParentId = new Map(subscriptions.map((sub) => [sub.parentId.toString(), sub]));

    const items = users.map((user) => {
      const parent = parentByUserId.get(user._id.toString()) || null;
      const parentKey = parent?._id.toString();
      return AdminUserListItemDTO.toResponse({
        user,
        parent,
        childrenCount: parentKey ? childrenCounts.get(parentKey) || 0 : 0,
        plan: subscriptionService.getEffectivePlan(parentKey ? subscriptionByParentId.get(parentKey) : null),
      });
    });

    return { items, pagination: toPagination(paging, total) };
  }

  /**
   * Parent accounts across the platform (not affected by the list filters)
   * @returns {Promise<{ total: number, active: number, locked: number, premium: number }>}
   */
  async getUserStats() {
    const [counts, premium] = await Promise.all([
      userService.countUsersByStatus(USER_ROLES.PARENT),
      subscriptionService.countPremiumParents(),
    ]);
    return { ...counts, premium };
  }

  /**
   * Get full details of a parent account: profile, children, plan in effect and activity summary
   * @param {string} userId
   */
  async getUserDetail(userId) {
    const user = await userService.getUserById(userId);
    if (user.role !== USER_ROLES.PARENT) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    const [children, lockedChildIds, subscription, connections, playdates, reports] = await Promise.all([
      childService.getAllChildrenByParentId(parent._id),
      childService.getLockedChildIds([parent._id]),
      // Same read as the parent app: an expired paid plan is moved to Free here (creates the Free row if missing)
      subscriptionService.getSubscriptionByParentId(parent._id),
      connectionService.countAcceptedConnections(parent._id),
      playdateService.getPlaydateCountsForParent(parent._id),
      safetyService.countReportsAgainstParent(parent._id),
    ]);

    const loginMethods = [
      ...(user.passwordHash ? [LOGIN_METHODS.PASSWORD] : []),
      ...(user.googleId ? [LOGIN_METHODS.GOOGLE] : []),
    ];

    return AdminUserDetailDTO.toResponse({
      user,
      parent,
      children,
      lockedChildIds,
      plan: subscriptionService.getEffectivePlan(subscription),
      loginMethods,
      activity: { connections, playdates, reports },
    });
  }

  /**
   * Update active status of a user (lock / unlock).
   * Locking revokes all active refresh tokens for the user.
   * Admins cannot lock themselves or other admins.
   * @param {string} adminUserId
   * @param {string} targetUserId
   * @param {{ isActive: boolean }} data
   */
  async updateUserStatus(adminUserId, targetUserId, { isActive }) {
    if (adminUserId && targetUserId.toString() === adminUserId.toString()) {
      throw new AppError('Admins cannot lock themselves', 403, 'CANNOT_LOCK_SELF');
    }

    const targetUser = await userService.getUserById(targetUserId);
    if (targetUser.role === USER_ROLES.ADMIN) {
      throw new AppError('Admins cannot lock other admins', 403, 'CANNOT_LOCK_ADMIN');
    }

    const boolActive = isActive === true || isActive === 'true';
    await userService.updateById(targetUserId, { isActive: boolActive });

    if (!boolActive) {
      await authService.revokeAllUserRefreshTokens(targetUserId);
    }

    void emitUserEvent(USER_EVENTS.USER_STATUS_CHANGED, {
      userId: targetUser._id,
      email: targetUser.email,
      isActive: boolActive,
    });

    return {
      id: targetUser._id,
      isActive: boolActive,
    };
  }

  /**
   * Get paginated child profiles with their parent and whether they can be seen in Discovery
   * @param {Object} queryParams
   */
  async getChildren(queryParams) {
    const paging = toPaging(queryParams);
    const search = queryParams.search?.trim() || '';
    const isPlanLocked = toOptionalBoolean(queryParams.isPlanLocked);
    const [searchParentIds, planLockedIds] = await Promise.all([
      search ? parentService.findParentIdsByName(search) : [],
      isPlanLocked === undefined ? null : childService.getAllPlanLockedChildIds().then((ids) => [...ids]),
    ]);

    const { items: children, total } = await childService.getChildrenPage({
      restrictToIds: isPlanLocked === true ? planLockedIds : null,
      excludeIds: isPlanLocked === false ? planLockedIds : null,
      search,
      searchParentIds,
      gender: queryParams.gender || undefined,
      isArchived: toOptionalBoolean(queryParams.isArchived),
      minAge: toOptionalInt(queryParams.minAge),
      maxAge: toOptionalInt(queryParams.maxAge),
      ...paging,
    });

    const parentIds = [...new Set(children.map((child) => child.parentId.toString()))];
    const parents = await parentService.getParentsByIds(parentIds);
    const [activeUserIds, lockedChildIds] = await Promise.all([
      userService.getActiveUserIds(parents.map((parent) => parent.userId)),
      childService.getLockedChildIds(parentIds),
    ]);
    const parentById = new Map(parents.map((parent) => [parent._id.toString(), parent]));
    const activeUserIdSet = new Set(activeUserIds);

    const items = children.map((child) => {
      const parent = parentById.get(child.parentId.toString()) || null;
      const isParentActive = parent ? activeUserIdSet.has(parent.userId.toString()) : false;
      return AdminChildListItemDTO.toResponse({
        child,
        parent,
        visibility: this._getChildVisibility({ child, parent, isParentActive, lockedChildIds }),
      });
    });

    return { items, pagination: toPagination(paging, total) };
  }

  /**
   * Child profiles across the platform (not affected by the list filters)
   * @returns {Promise<{ total: number, active: number, archived: number, planLocked: number }>}
   */
  async getChildStats() {
    return childService.getChildStats();
  }

  /**
   * Get full details of a child profile with parent summary and Discovery visibility
   * @param {string} childId
   */
  async getChildDetail(childId) {
    const child = await childService.getChildByIdRaw(childId);
    if (!child) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    const parent = child.parentId ? await parentService.getParentById(child.parentId) : null;
    const [user, lockedChildIds] = await Promise.all([
      parent?.userId ? userService.getUserById(parent.userId).catch(() => null) : null,
      parent ? childService.getLockedChildIds([parent._id]) : new Set(),
    ]);

    return AdminChildDetailDTO.toResponse({
      child,
      parent,
      user,
      visibility: this._getChildVisibility({
        child,
        parent,
        isParentActive: Boolean(user?.isActive),
        lockedChildIds,
      }),
    });
  }

  /**
   * Get payment history for a parent.
   * Intentionally reuses the parent-facing read, which first reconciles stale unpaid orders with PayOS,
   * so the admin sees the same settled statuses as the parent.
   * @param {{ parentId: string, page?: number, limit?: number }} params
   */
  async getPayments({ parentId, page, limit }) {
    return subscriptionService.getPaymentHistory(parentId, { page, limit });
  }

  /**
   * Accounts of the parents with Premium in effect
   * @private
   */
  async _getPremiumUserIds() {
    const parents = await parentService.getParentsByIds(await subscriptionService.getPremiumParentIds());
    return parents.map((parent) => parent.userId);
  }

  /**
   * First reason a child cannot be seen in Discovery (CHILD_VISIBILITY order), or VISIBLE
   * @private
   */
  _getChildVisibility({ child, parent, isParentActive, lockedChildIds }) {
    if (child.isArchived) return CHILD_VISIBILITY.ARCHIVED;
    if (!parent || !isParentActive) return CHILD_VISIBILITY.PARENT_LOCKED;
    if (lockedChildIds.has(child._id.toString())) return CHILD_VISIBILITY.PLAN_LOCKED;
    if (parent.privacySettings?.isProfileHidden) return CHILD_VISIBILITY.PARENT_HIDDEN;
    return CHILD_VISIBILITY.VISIBLE;
  }

  /**
   * Get paginated playdates across the platform
   * @param {{ status?: string, search?: string, fromDate?: string, toDate?: string, page?: string, limit?: string }} queryParams
   */
  async getPlaydates(queryParams) {
    const paging = toPaging(queryParams);
    const { items, total } = await playdateService.getPlaydatesForAdmin({
      status: queryParams.status,
      search: queryParams.search?.trim() || '',
      fromDate: queryParams.fromDate,
      toDate: queryParams.toDate,
      ...paging,
    });
    return { items: AdminPlaydateDTO.toResponseList(items), pagination: toPagination(paging, total) };
  }

  /**
   * Playdates across the platform by status (not affected by the list filters)
   * @returns {Promise<{ total: number, upcoming: number, completed: number, cancelled: number }>}
   */
  async getPlaydateStats() {
    return playdateService.getPlaydateStats();
  }

  /**
   * Get a playdate with its participants and pending reschedule request
   * @param {string} id
   */
  async getPlaydateDetail(id) {
    const { playdate, pendingReschedule } = await playdateService.getPlaydateDetailForAdmin(id);
    return AdminPlaydateDTO.toDetailResponse(playdate, pendingReschedule);
  }

  /**
   * Force-cancel an upcoming playdate (participations are given back as for a host cancellation)
   * Force-cancel an upcoming playdate
   * @param {string} id
   * @param {string} reason
   */
  async cancelPlaydate(id, reason) {
    const updated = await playdateService.cancelPlaydateByAdmin(id, reason);
    return AdminPlaydateDTO.toDetailResponse(updated);
  }

  /**
   * Get paginated connections across the platform
   * @param {{ status?: string, search?: string, page?: string, limit?: string }} queryParams
   */
  async getConnections(queryParams) {
    const paging = toPaging(queryParams);
    const { items, total } = await connectionService.getConnectionsForAdmin({
      status: queryParams.status,
      search: queryParams.search?.trim() || '',
      ...paging,
    });
    return { items: AdminConnectionDTO.toResponseList(items), pagination: toPagination(paging, total) };
  }

  /**
   * Connections across the platform by status (not affected by the list filters)
   * @returns {Promise<{ total: number, pending: number, accepted: number, declined: number, removed: number }>}
   */
  async getConnectionStats() {
    return connectionService.getConnectionStats();
  }

  /**
   * Get a connection with both parents
   * @param {string} id
   */
  async getConnectionDetail(id) {
    const connection = await connectionService.getConnectionDetailForAdmin(id);
    return AdminConnectionDTO.toDetailResponse(connection);
  }

  /**
   * Soft-remove a pending or accepted connection
   * @param {string} id
   * @param {string} [reason]
   */
  async removeConnection(id, reason) {
    const updated = await connectionService.removeConnectionByAdmin(id, reason);
    return AdminConnectionDTO.toDetailResponse(updated);
  }

  /**
   * Every subscription plan, inactive ones included
   */
  async getPlans() {
    const plans = await subscriptionService.getAllPlans();
    return plans.map((plan) => AdminPlanDTO.toResponse(plan));
  }

  /**
   * One plan as stored now (the edit form reloads it when opened)
   * @param {string} id
   */
  async getPlanDetail(id) {
    return AdminPlanDTO.toResponse(await subscriptionService.getPlanById(id));
  }

  /**
   * Update a plan (rules in SubscriptionService.updatePlanByAdmin)
   * Update a plan
   * @param {string} id
   * @param {{ name?: string, price?: number, isActive?: boolean, features?: Object }} data
   */
  async updatePlan(id, data) {
    const plan = await subscriptionService.updatePlanByAdmin(id, data);
    return AdminPlanDTO.toResponse(plan);
  }

  /**
   * Get paginated subscriptions with their parent
   * @param {{ planCode?: string, status?: string, search?: string, page?: string, limit?: string }} queryParams
   */
  async getSubscriptions(queryParams) {
    const paging = toPaging(queryParams);
    const search = queryParams.search?.trim() || '';
    const { items, total } = await subscriptionService.getSubscriptionsPageForAdmin({
      planCode: queryParams.planCode || undefined,
      status: queryParams.status || undefined,
      parentIds: search ? await this._findParentIdsBySearch(search) : null,
      ...paging,
    });

    const owners = await this._getParentOwners(items.map((item) => item.parentId));
    return {
      items: items.map((subscription) =>
        AdminSubscriptionDTO.toListItem({ subscription, ...owners.get(subscription.parentId.toString()) })
      ),
      pagination: toPagination(paging, total),
    };
  }

  /**
   * One subscription with its parent (the detail modal reloads it when opened)
   * One subscription with its parent
   * @param {string} id
   */
  async getSubscriptionDetail(id) {
    const subscription = await subscriptionService.getSubscriptionForAdmin(id);
    const owners = await this._getParentOwners([subscription.parentId]);
    return AdminSubscriptionDTO.toListItem({ subscription, ...owners.get(subscription.parentId.toString()) });
  }

  /**
   * Get paginated payments of every parent. The search matches the order code, parent name or email.
   * Get paginated payments of every parent
   * @param {{ status?: string, planCode?: string, fromDate?: string, toDate?: string, search?: string, page?: string, limit?: string }} queryParams
   */
  async getTransactions(queryParams) {
    const paging = toPaging(queryParams);
    const search = queryParams.search?.trim() || '';
    const { items, total } = await subscriptionService.getPaymentsPageForAdmin({
      status: queryParams.status || undefined,
      planCode: queryParams.planCode || undefined,
      fromDate: toDateBound(queryParams.fromDate),
      toDate: toDateBound(queryParams.toDate, { endOfDay: true }),
      searchParentIds: search ? await this._findParentIdsBySearch(search) : null,
      searchOrderCode: /^\d+$/.test(search) ? Number(search) : null,
      ...paging,
    });

    const owners = await this._getParentOwners(items.map((item) => item.parentId));
    return {
      items: items.map((payment) =>
        AdminTransactionDTO.toListItem({ payment, ...owners.get(payment.parentId.toString()) })
      ),
      pagination: toPagination(paging, total),
    };
  }

  /**
   * Get one payment for audit
   * @param {string} id
   */
  async getTransactionDetail(id) {
    const payment = await subscriptionService.getPaymentForAdmin(id);
    const owners = await this._getParentOwners([payment.parentId]);
    return AdminTransactionDTO.toDetailResponse({ payment, ...owners.get(payment.parentId.toString()) });
  }

  /**
   * Revenue overview of a period (default: the last REVENUE_DEFAULT_MONTHS calendar months).
   * Conversion = parents who ever paid / all parents; churn = churned in the period / Premium at its start.
   * Revenue overview of a period
   * @param {{ fromDate?: string, toDate?: string }} queryParams
   */
  async getRevenueSummary({ fromDate, toDate } = {}) {
    const end = toDateBound(toDate, { endOfDay: true }) || new Date();
    let start = toDateBound(fromDate);
    if (!start) {
      // 1st day of the month REVENUE_DEFAULT_MONTHS - 1 months before the end month
      const { year, month } = getZonedParts(end);
      const monthIndex = year * 12 + (month - 1) - (REVENUE_DEFAULT_MONTHS - 1);
      const startMonth = String((monthIndex % 12) + 1).padStart(2, '0');
      start = getZonedDayRange(`${Math.floor(monthIndex / 12)}-${startMonth}-01`).start;
    }

    const [metrics, totalParents] = await Promise.all([
      subscriptionService.getRevenueMetrics({ fromDate: start, toDate: end }),
      parentService.countParents(),
    ]);

    // Months without a payment are shown as 0 so the chart has no gap
    const revenueByMonth = new Map(metrics.monthlyRevenue.map((row) => [row.month, row]));
    const monthlyRevenue = listMonths(start, end).map((month) => {
      const [year, monthNumber] = month.split('-');
      return {
        month,
        label: `T${Number(monthNumber)}/${year}`,
        revenue: revenueByMonth.get(month)?.revenue || 0,
        transactionCount: revenueByMonth.get(month)?.transactionCount || 0,
      };
    });

    return {
      overview: {
        totalRevenue: metrics.totalRevenue,
        successfulTransactions: metrics.successfulTransactions,
        payingParentsCount: metrics.payingParentsCount,
        activePremiumSubscribers: metrics.activePremium,
        conversionRate: toPercent(metrics.allTimePayingParents, totalParents),
        churnRate: toPercent(metrics.churnedParents, metrics.premiumAtStart),
      },
      monthlyRevenue,
      filter: { fromDate: start.toISOString(), toDate: end.toISOString() },
    };
  }

  // ---------------------------------------------------------
  // SAFETY & REPORTS MODERATION
  // ---------------------------------------------------------

  /**
   * Get paginated safety reports with filtering and default sorting
   * @param {Object} queryParams
   * @param {string} [currentAdminUserId]
   */
  async getReports(queryParams, currentAdminUserId) {
    const paging = toPaging(queryParams);
    const match = {};

    if (queryParams.status) {
      match.status = queryParams.status;
    }
    if (queryParams.severity) {
      match.severity = queryParams.severity;
    }
    if (queryParams.category) {
      match.category = queryParams.category;
    }
    if (queryParams.targetType) {
      match.targetType = queryParams.targetType;
    }

    if (queryParams.assignedTo) {
      if (queryParams.assignedTo === 'me' && currentAdminUserId) {
        match.assignedTo = currentAdminUserId;
      } else {
        match.assignedTo = queryParams.assignedTo;
      }
    }

    if (queryParams.fromDate || queryParams.toDate) {
      const start = toDateBound(queryParams.fromDate);
      const end = toDateBound(queryParams.toDate, { endOfDay: true });
      match.createdAt = {};
      if (start) match.createdAt.$gte = start;
      if (end) match.createdAt.$lte = end;
    }

    if (queryParams.search?.trim()) {
      const searchParentIds = await this._findParentIdsBySearch(queryParams.search.trim());
      match.$or = [
        { reporterId: { $in: searchParentIds } },
        { reportedUserId: { $in: searchParentIds } },
        { reason: { $regex: queryParams.search.trim(), $options: 'i' } },
      ];
    }

    // Overdue filter
    const isOverdueFilter = toOptionalBoolean(queryParams.isOverdue);
    if (isOverdueFilter === true) {
      const now = Date.now();
      const criticalCutoff = new Date(now - 2 * 3600 * 1000);
      const regularCutoff = new Date(now - 24 * 3600 * 1000);
      match.status = { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING] };
      match.$and = [
        ...(match.$and || []),
        {
          $or: [
            { severity: REPORT_SEVERITY.CRITICAL, createdAt: { $lt: criticalCutoff } },
            { severity: { $ne: REPORT_SEVERITY.CRITICAL }, createdAt: { $lt: regularCutoff } },
          ],
        },
      ];
    }

    const pipeline = [
      { $match: match },
      {
        $addFields: {
          severityWeight: {
            $switch: {
              branches: [
                { case: { $eq: ['$severity', REPORT_SEVERITY.CRITICAL] }, then: 4 },
                { case: { $eq: ['$severity', REPORT_SEVERITY.HIGH] }, then: 3 },
                { case: { $eq: ['$severity', REPORT_SEVERITY.MEDIUM] }, then: 2 },
                { case: { $eq: ['$severity', REPORT_SEVERITY.LOW] }, then: 1 },
              ],
              default: 2,
            },
          },
        },
      },
      { $sort: { severityWeight: -1, createdAt: 1 } },
      {
        $facet: {
          items: [{ $skip: (paging.page - 1) * paging.limit }, { $limit: paging.limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await Report.aggregate(pipeline);
    const reports = result?.items || [];
    const total = result?.totalCount?.[0]?.count || 0;

    // Collect IDs for population
    const parentIds = new Set();
    const adminUserIds = new Set();
    reports.forEach((r) => {
      if (r.reporterId) parentIds.add(String(r.reporterId));
      if (r.reportedUserId) parentIds.add(String(r.reportedUserId));
      if (r.assignedTo) adminUserIds.add(String(r.assignedTo));
    });

    const [parents, adminUsers] = await Promise.all([
      parentService.getParentsByIds([...parentIds]),
      User.find({ _id: { $in: [...adminUserIds] } }).lean(),
    ]);

    const parentMap = new Map(parents.map((p) => [String(p._id), p]));
    const userIds = parents.map((p) => p.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const adminUserMap = new Map(adminUsers.map((u) => [String(u._id), u]));

    const items = reports.map((report) => {
      const reporterParent = parentMap.get(String(report.reporterId));
      const reportedParent = parentMap.get(String(report.reportedUserId));
      const reportedUser = reportedParent ? userMap.get(String(reportedParent.userId)) : null;
      const assignedUser = report.assignedTo ? adminUserMap.get(String(report.assignedTo)) : null;
      const isOverdue = checkIsOverdue(report);

      return AdminReportListItemDTO.toResponse({
        report,
        reporterParent,
        reportedParent,
        reportedUser,
        assignedUser,
        isOverdue,
      });
    });

    return {
      items,
      pagination: toPagination(paging, total),
    };
  }

  /**
   * Queue stats & SLA statistics
   * @param {Object} queryParams
   */
  async getReportStats(queryParams = {}) {
    const match = {};
    if (queryParams.fromDate || queryParams.toDate) {
      const start = toDateBound(queryParams.fromDate);
      const end = toDateBound(queryParams.toDate, { endOfDay: true });
      match.createdAt = {};
      if (start) match.createdAt.$gte = start;
      if (end) match.createdAt.$lte = end;
    }

    const now = Date.now();
    const criticalCutoff = new Date(now - 2 * 3600 * 1000);
    const regularCutoff = new Date(now - 24 * 3600 * 1000);

    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(today.setDate(diff));
    startOfWeek.setHours(0, 0, 0, 0);

    const [
      pending,
      reviewing,
      dismissed,
      resolvedThisWeek,
      criticalPending,
      overdueCritical,
      overdueRegular,
      avgResult,
    ] = await Promise.all([
      Report.countDocuments({ ...match, status: REPORT_STATUS.PENDING }),
      Report.countDocuments({ ...match, status: REPORT_STATUS.REVIEWING }),
      Report.countDocuments({ ...match, status: REPORT_STATUS.DISMISSED }),
      Report.countDocuments({ ...match, status: REPORT_STATUS.RESOLVED, resolvedAt: { $gte: startOfWeek } }),
      Report.countDocuments({ ...match, status: REPORT_STATUS.PENDING, severity: REPORT_SEVERITY.CRITICAL }),
      Report.countDocuments({
        ...match,
        status: { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING] },
        severity: REPORT_SEVERITY.CRITICAL,
        createdAt: { $lt: criticalCutoff },
      }),
      Report.countDocuments({
        ...match,
        status: { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING] },
        severity: { $ne: REPORT_SEVERITY.CRITICAL },
        createdAt: { $lt: regularCutoff },
      }),
      Report.aggregate([
        {
          $match: {
            ...match,
            status: REPORT_STATUS.RESOLVED,
            resolvedAt: { $ne: null },
          },
        },
        {
          $project: {
            resolutionHours: {
              $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, 3600000],
            },
          },
        },
        {
          $group: {
            _id: null,
            avgHours: { $avg: '$resolutionHours' },
          },
        },
      ]),
    ]);

    const overdue = overdueCritical + overdueRegular;
    const avgResolutionHours = avgResult?.[0]?.avgHours ? Number(avgResult[0].avgHours.toFixed(1)) : 0;

    return {
      pending,
      reviewing,
      resolvedThisWeek,
      dismissed,
      overdue,
      criticalPending,
      avgResolutionHours,
    };
  }

  /**
   * Full investigation detail of a report
   * @param {string} id
   */
  async getReportDetail(id) {
    const report = await Report.findById(id).lean();
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    const [
      reporterParent,
      reportedParent,
      assignedUser,
      resolvedByUser,
      totalReportsSubmitted,
      previousReportsWithActions,
      relatedOpenReportsRaw,
    ] = await Promise.all([
      parentService.getParentById(report.reporterId),
      parentService.getParentById(report.reportedUserId),
      report.assignedTo ? User.findById(report.assignedTo).lean() : null,
      report.resolvedBy ? User.findById(report.resolvedBy).lean() : null,
      Report.countDocuments({ reporterId: report.reporterId }),
      Report.find({
        reportedUserId: report.reportedUserId,
        _id: { $ne: report._id },
        'actions.0': { $exists: true },
      })
        .select('actions')
        .lean(),
      Report.find({
        reportedUserId: report.reportedUserId,
        _id: { $ne: report._id },
        status: { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING] },
      })
        .select('category severity createdAt reporterId')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const [reporterUser, reportedUser] = await Promise.all([
      reporterParent?.userId ? User.findById(reporterParent.userId).lean() : null,
      reportedParent?.userId ? User.findById(reportedParent.userId).lean() : null,
    ]);

    const previousSanctions = [];
    previousReportsWithActions.forEach((r) => {
      (r.actions || []).forEach((act) => {
        previousSanctions.push({
          type: act.type,
          performedAt: act.performedAt,
          note: act.note,
        });
      });
    });

    const relatedReporterIds = [...new Set(relatedOpenReportsRaw.map((r) => String(r.reporterId)))];
    const relatedReporters = await parentService.getParentsByIds(relatedReporterIds);
    const relatedReportersMap = new Map(relatedReporters.map((p) => [String(p._id), p.fullName]));

    const relatedOpenReports = relatedOpenReportsRaw.map((r) => ({
      id: r._id.toString(),
      category: r.category,
      severity: r.severity,
      createdAt: r.createdAt,
      reporterName: relatedReportersMap.get(String(r.reporterId)) || 'Người dùng BuddyLink',
    }));

    let targetContext = null;
    if (report.targetType === 'message' && report.targetMessageId) {
      targetContext = await chatService.getMessageContext(report.targetMessageId);
    } else if (report.targetType === 'playdate' && report.targetPlaydateId) {
      try {
        const pdDetail = await playdateService.getPlaydateDetailForAdmin(report.targetPlaydateId);
        targetContext = {
          type: 'playdate',
          playdate: pdDetail.playdate,
          pendingReschedule: pdDetail.pendingReschedule,
        };
      } catch (_e) {
        targetContext = { type: 'playdate', playdate: null };
      }
    } else if (report.targetType === 'user') {
      const childrenCounts = await childService.countActiveChildrenByParentIds([report.reportedUserId]);
      targetContext = {
        type: 'user',
        childrenCount: childrenCounts.get(String(report.reportedUserId)) || 0,
      };
    }

    const isOverdue = checkIsOverdue(report);

    return AdminReportDetailDTO.toResponse({
      report,
      reporterParent,
      reporterUser,
      reportedParent,
      reportedUser,
      assignedUser,
      resolvedByUser,
      targetContext,
      relatedOpenReports,
      isOverdue,
      totalReportsSubmitted,
      previousSanctions,
    });
  }

  /**
   * Claim or Takeover a report
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ action: 'claim' | 'takeover' }} param2
   */
  async reviewReport(adminUserId, id, { action }) {
    const report = await Report.findById(id);
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if (action === 'claim') {
      if (report.status !== REPORT_STATUS.PENDING && report.status !== REPORT_STATUS.REVIEWING) {
        throw new AppError('Can only claim pending or reviewing reports', 400, 'INVALID_STATUS_TRANSITION');
      }
      const fromStatus = report.status;
      report.status = REPORT_STATUS.REVIEWING;
      report.assignedTo = adminUserId;
      report.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.CLAIM,
        fromStatus,
        toStatus: REPORT_STATUS.REVIEWING,
        by: adminUserId,
        at: new Date(),
        note: 'Tiếp nhận xử lý vụ việc',
      });
    } else if (action === 'takeover') {
      if (report.status !== REPORT_STATUS.REVIEWING) {
        throw new AppError('Can only takeover reports in reviewing status', 400, 'INVALID_STATUS_TRANSITION');
      }
      report.assignedTo = adminUserId;
      report.history.push({
        eventType: REPORT_HISTORY_EVENT_TYPES.TAKEOVER,
        fromStatus: REPORT_STATUS.REVIEWING,
        toStatus: REPORT_STATUS.REVIEWING,
        by: adminUserId,
        at: new Date(),
        note: 'Tiếp quản xử lý vụ việc từ người khác',
      });
    }

    await report.save();
    return this.getReportDetail(id);
  }

  /**
   * Update report severity during review
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ severity: string, note?: string }} param2
   */
  async updateReportSeverity(adminUserId, id, { severity, note }) {
    const report = await Report.findById(id);
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if (report.status !== REPORT_STATUS.REVIEWING) {
      throw new AppError('Can only change severity when reviewing', 400, 'INVALID_STATUS_TRANSITION');
    }

    const oldSeverity = report.severity;
    report.severity = severity;
    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.SEVERITY_CHANGE,
      fromStatus: report.status,
      toStatus: report.status,
      by: adminUserId,
      at: new Date(),
      note: note || `Đổi mức độ nghiêm trọng từ ${oldSeverity} sang ${severity}`,
      metadata: { oldSeverity, newSeverity: severity },
    });

    await report.save();
    return this.getReportDetail(id);
  }

  /**
   * Apply sanction action on reported target
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ type: string, durationDays?: number, note?: string }} param2
   */
  async applyReportAction(adminUserId, id, { type, durationDays, note }) {
    const report = await Report.findById(id);
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if ([REPORT_STATUS.RESOLVED, REPORT_STATUS.DISMISSED].includes(report.status)) {
      throw new AppError('Cannot apply action on closed report', 409, 'REPORT_ALREADY_CLOSED');
    }

    const alreadyApplied = (report.actions || []).some((act) => act.type === type);
    if (alreadyApplied) {
      throw new AppError('This action has already been applied to this report', 409, 'ACTION_ALREADY_APPLIED');
    }

    const reportedParent = await parentService.getParentById(report.reportedUserId);
    if (!reportedParent) {
      throw new AppError('Reported parent not found', 404, 'REPORTED_USER_NOT_FOUND');
    }
    const targetUserId = reportedParent.userId;
    const targetUser = await userService.getUserById(targetUserId);

    if (type === REPORT_ACTION_TYPES.WARN) {
      await User.findByIdAndUpdate(targetUserId, { $inc: { strikeCount: 1 } });
      await notificationService.createNotification({
        recipientId: targetUserId,
        type: 'system',
        title: 'Cảnh cáo vi phạm an toàn',
        body: `Bạn nhận được 1 cảnh cáo do vi phạm quy chuẩn cộng đồng liên quan đến: ${report.category}. Vui lòng tuân thủ quy tắc để giữ an toàn cho cộng đồng.`,
        data: { reportId: report._id.toString() },
      });
    } else if (type === REPORT_ACTION_TYPES.DELETE_MESSAGE) {
      if (report.targetType !== 'message' || !report.targetMessageId) {
        throw new AppError('Report is not targeting a message', 400, 'INVALID_ACTION_TYPE');
      }
      const delResult = await chatService.adminDeleteMessage(report.targetMessageId);
      if (delResult.alreadyDeleted) {
        throw new AppError('Message is already deleted', 409, 'ACTION_ALREADY_APPLIED');
      }
      await notificationService.createNotification({
        recipientId: targetUserId,
        type: 'system',
        title: 'Tin nhắn đã bị gỡ bỏ',
        body: 'Một tin nhắn của bạn đã bị Quản trị viên xóa do vi phạm quy chuẩn nội dung an toàn.',
        data: { reportId: report._id.toString() },
      });
    } else if (type === REPORT_ACTION_TYPES.CANCEL_PLAYDATE) {
      if (report.targetType !== 'playdate' || !report.targetPlaydateId) {
        throw new AppError('Report is not targeting a playdate', 400, 'INVALID_ACTION_TYPE');
      }
      await playdateService.cancelPlaydateByAdmin(
        report.targetPlaydateId,
        note || 'Hủy bởi Quản trị viên do vi phạm an toàn'
      );
    } else if (type === REPORT_ACTION_TYPES.SUSPEND) {
      const days = parseInt(durationDays, 10);
      if (!days || days < 1) {
        throw new AppError('durationDays must be at least 1', 400, 'DURATION_DAYS_REQUIRED');
      }
      const suspensionUntil = new Date(Date.now() + days * 24 * 3600 * 1000);
      await User.findByIdAndUpdate(targetUserId, { $set: { isActive: false, suspensionUntil } });
      await authService.revokeAllUserRefreshTokens(targetUserId);

      try {
        const io = getIO();
        if (io) {
          io.to(`user:${targetUserId.toString()}`).emit('account:locked', {
            reason: `Tài khoản tạm thời bị đình chỉ trong ${days} ngày vì vi phạm quy chuẩn an toàn.`,
          });
          io.in(`user:${targetUserId.toString()}`).disconnectSockets(true);
        }
      } catch (_err) {}

      await notificationService.createNotification({
        recipientId: targetUserId,
        type: 'system',
        title: 'Tài khoản bị tạm đình chỉ',
        body: `Tài khoản của bạn đã bị tạm đình chỉ trong ${days} ngày cho đến ${suspensionUntil.toLocaleString('vi-VN')} do vi phạm quy chuẩn an toàn.`,
        data: { reportId: report._id.toString() },
      });
    } else if (type === REPORT_ACTION_TYPES.BAN) {
      if (!targetUser.isActive && !targetUser.suspensionUntil) {
        throw new AppError('User is already permanently banned', 409, 'ACTION_ALREADY_APPLIED');
      }
      await User.findByIdAndUpdate(targetUserId, {
        $set: { isActive: false, suspensionUntil: null, banReason: note || 'Khóa tài khoản vĩnh viễn' },
      });
      await authService.revokeAllUserRefreshTokens(targetUserId);

      try {
        const io = getIO();
        if (io) {
          io.to(`user:${targetUserId.toString()}`).emit('account:locked', {
            reason: 'Tài khoản của bạn đã bị khóa vĩnh viễn do vi phạm nghiêm trọng an toàn cộng đồng.',
          });
          io.in(`user:${targetUserId.toString()}`).disconnectSockets(true);
        }
      } catch (_err) {}
    }

    report.actions.push({
      type,
      params: { durationDays: durationDays ? parseInt(durationDays, 10) : null, reason: note || '' },
      performedBy: adminUserId,
      performedAt: new Date(),
      note: note || '',
    });

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.ACTION_APPLIED,
      fromStatus: report.status,
      toStatus: report.status,
      by: adminUserId,
      at: new Date(),
      note: note || `Đã thi hành chế tài: ${type}`,
      metadata: { actionType: type, durationDays },
    });

    await report.save();
    return this.getReportDetail(id);
  }

  /**
   * Resolve or dismiss a report
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ status: string, resolution: string, adminNotes: string, applyToRelatedReportIds?: string[] }} param2
   */
  async resolveReport(adminUserId, id, { status, resolution, adminNotes, applyToRelatedReportIds = [] }) {
    const report = await Report.findById(id);
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if ([REPORT_STATUS.RESOLVED, REPORT_STATUS.DISMISSED].includes(report.status)) {
      throw new AppError('Report is already closed', 409, 'REPORT_ALREADY_CLOSED');
    }

    if (status === REPORT_STATUS.RESOLVED && resolution === REPORT_RESOLUTION_TYPES.ACTION_TAKEN) {
      if (!report.actions || report.actions.length === 0) {
        throw new AppError('Resolved report with action_taken requires at least one action', 400, 'ACTIONS_REQUIRED_FOR_RESOLVE');
      }
    }

    const fromStatus = report.status;
    report.status = status;
    report.resolution = resolution;
    report.adminNotes = adminNotes;
    report.resolvedBy = adminUserId;
    report.resolvedAt = new Date();

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.STATUS_CHANGE,
      fromStatus,
      toStatus: status,
      by: adminUserId,
      at: new Date(),
      note: adminNotes,
      metadata: { resolution },
    });

    await report.save();

    // Reporter notification (BR-12: no sanction disclosure)
    const reporterParent = await parentService.getParentById(report.reporterId);
    if (reporterParent?.userId) {
      await notificationService.createNotification({
        recipientId: reporterParent.userId,
        type: 'system',
        title: 'Cập nhật báo cáo vi phạm',
        body:
          status === REPORT_STATUS.RESOLVED
            ? 'Báo cáo của bạn về tài khoản đã được xử lý theo Quy chuẩn Cộng đồng BuddyLink. Cảm ơn bạn đã chung tay bảo vệ an toàn cho các bé.'
            : 'Báo cáo của bạn đã được ban quản trị xem xét và lưu hồ sơ theo dõi.',
        data: { reportId: report._id.toString() },
      });
    }

    // Bulk resolve related open reports
    if (Array.isArray(applyToRelatedReportIds) && applyToRelatedReportIds.length > 0) {
      const relatedReports = await Report.find({
        _id: { $in: applyToRelatedReportIds },
        reportedUserId: report.reportedUserId,
        status: { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.REVIEWING] },
      });

      for (const rel of relatedReports) {
        const prevStatus = rel.status;
        rel.status = status;
        rel.resolution = resolution;
        rel.adminNotes = adminNotes;
        rel.resolvedBy = adminUserId;
        rel.resolvedAt = new Date();
        rel.history.push({
          eventType: REPORT_HISTORY_EVENT_TYPES.STATUS_CHANGE,
          fromStatus: prevStatus,
          toStatus: status,
          by: adminUserId,
          at: new Date(),
          note: `Đóng đồng loạt theo báo cáo ${report._id}: ${adminNotes}`,
          metadata: { resolution, parentReportId: report._id },
        });
        await rel.save();

        const relReporter = await parentService.getParentById(rel.reporterId);
        if (relReporter?.userId) {
          await notificationService.createNotification({
            recipientId: relReporter.userId,
            type: 'system',
            title: 'Cập nhật báo cáo vi phạm',
            body:
              status === REPORT_STATUS.RESOLVED
                ? 'Báo cáo của bạn về tài khoản đã được xử lý theo Quy chuẩn Cộng đồng BuddyLink. Cảm ơn bạn đã chung tay bảo vệ an toàn cho các bé.'
                : 'Báo cáo của bạn đã được ban quản trị xem xét và lưu hồ sơ theo dõi.',
            data: { reportId: rel._id.toString() },
          });
        }
      }
    }

    return this.getReportDetail(id);
  }

  /**
   * Reopen a closed report
   * @param {string} adminUserId
   * @param {string} id
   * @param {{ note: string }} param2
   */
  async reopenReport(adminUserId, id, { note }) {
    const report = await Report.findById(id);
    if (!report) {
      throw new AppError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    if (![REPORT_STATUS.RESOLVED, REPORT_STATUS.DISMISSED].includes(report.status)) {
      throw new AppError('Only closed reports can be reopened', 400, 'INVALID_STATUS_TRANSITION');
    }

    const fromStatus = report.status;
    report.status = REPORT_STATUS.REVIEWING;
    report.resolvedBy = null;
    report.resolvedAt = null;

    report.history.push({
      eventType: REPORT_HISTORY_EVENT_TYPES.REOPEN,
      fromStatus,
      toStatus: REPORT_STATUS.REVIEWING,
      by: adminUserId,
      at: new Date(),
      note,
    });

    await report.save();
    return this.getReportDetail(id);
  }

  /**
   * Parents whose name or account email contains the text
   * @private
   */
  async _findParentIdsBySearch(search) {
    const [nameMatchIds, emailUserIds] = await Promise.all([
      parentService.findParentIdsByName(search),
      userService.findUserIdsByEmail(search),
    ]);
    const emailParents = await parentService.getParentsByUserIds(emailUserIds);
    const idByKey = new Map([...nameMatchIds, ...emailParents.map((parent) => parent._id)].map((id) => [String(id), id]));
    return [...idByKey.values()];
  }

  /**
   * Parent profile and account email of each parent id
   * @private
   * @returns {Promise<Map<string, { parent: Object, email: string }>>}
   */
  async _getParentOwners(parentIds) {
    const uniqueIds = [...new Set(parentIds.map(String))];
    const parents = await parentService.getParentsByIds(uniqueIds);
    const users = await userService.getEmailsByIds(parents.map((parent) => parent.userId));
    const emailByUserId = new Map(users.map((user) => [user._id.toString(), user.email]));
    return new Map(
      parents.map((parent) => [parent._id.toString(), { parent, email: emailByUserId.get(parent.userId.toString()) }])
    );
  }

  /**
   * Comprehensive System Analytics with 9 KPIs compared to previous period,
   * detailed section breakdowns, and conversion funnel
   * @param {{ fromDate?: string, toDate?: string, groupBy?: 'day'|'week'|'month' }} query
   */
  async getAnalytics({ fromDate, toDate, groupBy = ANALYTICS_GROUP_BY.DAY } = {}) {
    const timeZone = env.APP_TIMEZONE;
    const { start, end } = toAnalyticsRange({ fromDate, toDate });

    // Previous period of equal length
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const dateFormat = ANALYTICS_DATE_FORMATS[groupBy];
    const periods = listAnalyticsPeriods(start, end, groupBy);

    const [
      totalParentsVal,
      totalParentsPrev,
      newParentsVal,
      newParentsPrev,
      totalChildrenVal,
      totalChildrenPrev,
      totalPlaydatesVal,
      totalPlaydatesPrev,
      acceptedConnectionsVal,
      acceptedConnectionsPrev,
      activePremiumVal,
      activePremiumPrev,
      revenueMetricsVal,
      revenueMetricsPrev,
      aiUsageVal,
      aiUsagePrev,
    ] = await Promise.all([
      userService.countParentsBeforeDate(end),
      userService.countParentsBeforeDate(prevEnd),
      userService.countNewParentsBetween(start, end),
      userService.countNewParentsBetween(prevStart, prevEnd),
      childService.countActiveBeforeDate(end),
      childService.countActiveBeforeDate(prevEnd),
      playdateService.countCreatedBetween(start, end),
      playdateService.countCreatedBetween(prevStart, prevEnd),
      connectionService.countAcceptedBetween(start, end),
      connectionService.countAcceptedBetween(prevStart, prevEnd),
      subscriptionService.countParentsWithPremiumAt(end),
      subscriptionService.countParentsWithPremiumAt(prevEnd),
      subscriptionService.getRevenueMetrics({ fromDate: start, toDate: end, dateFormat }),
      subscriptionService.getRevenueMetrics({ fromDate: prevStart, toDate: prevEnd }),
      aiAssistantService.countAiMessagesBetween(start, end),
      aiAssistantService.countAiMessagesBetween(prevStart, prevEnd),
    ]);

    const overview = {
      totalParents: calculateKpi(totalParentsVal, totalParentsPrev),
      newParents: calculateKpi(newParentsVal, newParentsPrev),
      totalChildProfiles: calculateKpi(totalChildrenVal, totalChildrenPrev),
      totalPlaydates: calculateKpi(totalPlaydatesVal, totalPlaydatesPrev),
      acceptedConnections: calculateKpi(acceptedConnectionsVal, acceptedConnectionsPrev),
      activePremiumSubscriptions: calculateKpi(activePremiumVal, activePremiumPrev),
      totalRevenue: calculateKpi(revenueMetricsVal.totalRevenue, revenueMetricsPrev.totalRevenue),
      successfulTransactions: calculateKpi(
        revenueMetricsVal.successfulTransactions,
        revenueMetricsPrev.successfulTransactions
      ),
      aiUsage: calculateKpi(aiUsageVal, aiUsagePrev),
    };

    const [
      newParentsTimeline,
      playdateAnalytics,
      connectionAnalytics,
      subscriptionPlanCounts,
      aiAnalytics,
      childAgeGroups,
      parentsWithChildrenCount,
      parentsWithConnectionCount,
      parentsWithPlaydateCount,
      payingParentsCount,
    ] = await Promise.all([
      userService.getNewParentsTimeline({ fromDate: start, toDate: end, dateFormat, timeZone }),
      playdateService.getPlaydateAnalytics({ fromDate: start, toDate: end, dateFormat, timeZone }),
      connectionService.getConnectionAnalytics({ fromDate: start, toDate: end }),
      subscriptionService.countActiveByPlan(end),
      aiAssistantService.getAiAnalytics({
        fromDate: start,
        toDate: end,
        dateFormat,
        timeZone,
        topLimit: ANALYTICS_TOP_AI_PARENTS,
      }),
      childService.getChildAgeGroupStats(),
      childService.countDistinctParentsWithActiveChildrenBeforeDate(end),
      connectionService.countDistinctParentsWithConnectionBeforeDate(end),
      playdateService.countDistinctParentsWithPlaydateBeforeDate(end),
      subscriptionService.countPayingParentsUntil(end),
    ]);

    const newParentsByPeriod = toCountByPeriod(newParentsTimeline);
    const userGrowthTimeline = periods.map(({ period, label }) => ({
      period,
      label,
      count: newParentsByPeriod.get(period) || 0,
    }));

    const revenueByPeriod = new Map(revenueMetricsVal.revenueByPeriod.map((row) => [row.period, row]));
    const revenueTimeline = periods.map(({ period, label }) => ({
      period,
      label,
      revenue: revenueByPeriod.get(period)?.revenue || 0,
      transactionCount: revenueByPeriod.get(period)?.transactionCount || 0,
    }));

    const playdatesByPeriod = toCountByPeriod(playdateAnalytics.timeline);
    const playdateTimeline = periods.map(({ period, label }) => ({
      period,
      label,
      count: playdatesByPeriod.get(period) || 0,
    }));

    const aiByPeriod = toCountByPeriod(aiAnalytics.timeline);
    const aiTimeline = periods.map(({ period, label }) => ({
      period,
      label,
      count: aiByPeriod.get(period) || 0,
    }));

    const funnel = [
      { step: 'registered', label: 'Đăng ký tài khoản', count: totalParentsVal },
      { step: 'withChildProfile', label: 'Tạo hồ sơ bé', count: parentsWithChildrenCount },
      { step: 'firstConnection', label: 'Có kết nối', count: parentsWithConnectionCount },
      { step: 'firstPlaydate', label: 'Tham gia playdate', count: parentsWithPlaydateCount },
      { step: 'paid', label: 'Nâng cấp Premium', count: payingParentsCount },
    ];

    return {
      overview,
      userGrowth: {
        totalParents: totalParentsVal,
        newParentsInPeriod: newParentsVal,
        timeline: userGrowthTimeline,
      },
      revenue: {
        totalRevenue: revenueMetricsVal.totalRevenue,
        successfulTransactions: revenueMetricsVal.successfulTransactions,
        payingParentsCount: revenueMetricsVal.payingParentsCount,
        timeline: revenueTimeline,
      },
      conversion: {
        funnel,
        conversionRate: toPercent(payingParentsCount, totalParentsVal),
        churnRate: toPercent(revenueMetricsVal.churnedParents, revenueMetricsVal.premiumAtStart),
      },
      playdates: {
        byStatus: playdateAnalytics.byStatus,
        timeline: playdateTimeline,
      },
      connections: connectionAnalytics,
      subscriptions: {
        byPlan: subscriptionPlanCounts,
        activePremium: activePremiumVal,
        churnedParents: revenueMetricsVal.churnedParents,
      },
      aiUsage: {
        totalMessagesInPeriod: aiUsageVal,
        timeline: aiTimeline,
        topParents: aiAnalytics.topParents,
      },
      children: {
        total: totalChildrenVal,
        byAgeGroup: childAgeGroups,
      },
      filter: {
        fromDate: start.toISOString(),
        toDate: end.toISOString(),
        groupBy,
      },
    };
  }

  /**
   * Paginated list of admin notifications
   * @param {Object} options
   */
  async getNotifications({ category, severity, isRead, page = 1, limit = 20, adminId }) {
    const paging = toPaging({ page, limit });
    const { items, total } = await adminNotificationService.getNotificationPage({
      category: category !== ADMIN_NOTIFICATION_FILTER_ALL ? category : undefined,
      severity: severity !== ADMIN_NOTIFICATION_FILTER_ALL ? severity : undefined,
      isRead: toOptionalBoolean(isRead),
      adminId,
      page: paging.page,
      limit: paging.limit,
    });
    return {
      items,
      pagination: toPagination(paging, total),
    };
  }

  /**
   * Count unread notifications by category and total
   * @param {string|ObjectId} adminId
   */
  async getUnreadNotificationCount(adminId) {
    return adminNotificationService.getUnreadCount(adminId);
  }

  /**
   * Mark single notification as read
   * @param {string} id
   * @param {string|ObjectId} adminId
   */
  async markNotificationAsRead(id, adminId) {
    return adminNotificationService.markAsRead(id, adminId);
  }

  /**
   * Mark all notifications (or all in a category) as read
   * @param {string|ObjectId} adminId
   * @param {string} [category]
   */
  async markAllNotificationsAsRead(adminId, category) {
    return adminNotificationService.markAllAsRead(
      adminId,
      category !== ADMIN_NOTIFICATION_FILTER_ALL ? category : undefined
    );
  }
}

export default new AdminService();
