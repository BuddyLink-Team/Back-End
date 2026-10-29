import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import authService from '../auth/auth.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import connectionService from '../connection/connection.service.js';
import playdateService from '../playdate/playdate.service.js';
import safetyService from '../safety/safety.service.js';
import aiAssistantService from '../ai-assistant/ai-assistant.service.js';
import adminNotificationRepository from './admin-notification.repository.js';
import { getAdminIO } from '../../config/socket.js';
import env from '../../config/env.js';
import AppError from '../../shared/exceptions/app-error.js';
import { USER_ROLES, PAGINATION } from '../../shared/constants/index.js';
import { getZonedParts, getZonedDayRange } from '../../shared/helpers/date.helper.js';
import { CHILD_VISIBILITY, LOGIN_METHODS, REVENUE_DEFAULT_MONTHS } from './admin.constants.js';
import { emitUserEvent, USER_EVENTS } from '../user/user.events.js';
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

const getWeekBucketString = (date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.getTime()) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};

const generatePeriodBuckets = (start, end, groupBy, timeZone = env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh') => {
  if (groupBy === 'month') {
    return listMonths(start, end);
  }

  const buckets = [];
  const current = new Date(start);
  const endMs = end.getTime();

  if (groupBy === 'week') {
    while (current.getTime() <= endMs) {
      const weekStr = getWeekBucketString(current);
      if (!buckets.includes(weekStr)) {
        buckets.push(weekStr);
      }
      current.setDate(current.getDate() + 7);
    }
    return buckets;
  }

  // default 'day'
  while (current.getTime() <= endMs) {
    const parts = getZonedParts(current, timeZone);
    const dayStr = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    if (!buckets.includes(dayStr)) {
      buckets.push(dayStr);
    }
    current.setDate(current.getDate() + 1);
  }
  return buckets;
};

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
   * @param {string} id
   */
  async getSubscriptionDetail(id) {
    const subscription = await subscriptionService.getSubscriptionForAdmin(id);
    const owners = await this._getParentOwners([subscription.parentId]);
    return AdminSubscriptionDTO.toListItem({ subscription, ...owners.get(subscription.parentId.toString()) });
  }

  /**
   * Get paginated payments of every parent. The search matches the order code, parent name or email.
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
  async getAnalytics({ fromDate, toDate, groupBy = 'day' } = {}) {
    const timeZone = env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh';
    const end = toDateBound(toDate, { endOfDay: true }) || new Date();
    let start = toDateBound(fromDate);
    if (!start) {
      // Default: last 30 days
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      start = new Date(end.getTime() - thirtyDaysMs);
    }

    // Previous period of equal length
    const durationMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const dateFormat = groupBy === 'month' ? '%Y-%m' : groupBy === 'week' ? '%Y-W%V' : '%Y-%m-%d';

    // Fetch Overview KPIs in parallel
    const [
      totalParentsVal,
      totalParentsPrev,
      newParentsVal,
      newParentsPrev,
      activeUsersVal,
      activeUsersPrev,
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
      userService.countActiveParents(end),
      userService.countActiveParents(prevEnd),
      childService.countActiveBeforeDate(end),
      childService.countActiveBeforeDate(prevEnd),
      playdateService.countBeforeDate(end),
      playdateService.countBeforeDate(prevEnd),
      connectionService.countAcceptedBeforeDate(end),
      connectionService.countAcceptedBeforeDate(prevEnd),
      subscriptionService.countActivePaid(end),
      subscriptionService.countActivePaid(prevEnd),
      subscriptionService.getRevenueMetrics({ fromDate: start, toDate: end }),
      subscriptionService.getRevenueMetrics({ fromDate: prevStart, toDate: prevEnd }),
      aiAssistantService.countAiMessagesBetween(start, end),
      aiAssistantService.countAiMessagesBetween(prevStart, prevEnd),
    ]);

    const overview = {
      totalParents: calculateKpi(totalParentsVal, totalParentsPrev),
      newParents: calculateKpi(newParentsVal, newParentsPrev),
      activeUsers: calculateKpi(activeUsersVal, activeUsersPrev),
      totalChildProfiles: calculateKpi(totalChildrenVal, totalChildrenPrev),
      totalPlaydates: calculateKpi(totalPlaydatesVal, totalPlaydatesPrev),
      acceptedConnections: calculateKpi(acceptedConnectionsVal, acceptedConnectionsPrev),
      activePremiumSubscriptions: calculateKpi(activePremiumVal, activePremiumPrev),
      totalRevenue: calculateKpi(revenueMetricsVal.totalRevenue, revenueMetricsPrev.totalRevenue),
      aiUsage: calculateKpi(aiUsageVal, aiUsagePrev),
    };

    // Detailed stats sections
    const buckets = generatePeriodBuckets(start, end, groupBy, timeZone);

    const [
      newParentsTimeline,
      revenueTimelineRows,
      playdateAnalytics,
      connectionAnalytics,
      subscriptionPlanCounts,
      aiAnalytics,
      childAgeGroups,
      parentsWithChildrenCount,
      parentsWithConnectionCount,
      parentsWithPlaydateCount,
    ] = await Promise.all([
      userService.getNewParentsTimeline({ fromDate: start, toDate: end, dateFormat, timeZone }),
      subscriptionService.sumSuccessfulPaidByPeriod({ fromDate: start, toDate: end, dateFormat, timeZone }),
      playdateService.getPlaydateAnalytics({ fromDate: start, toDate: end, dateFormat, timeZone }),
      connectionService.getConnectionAnalytics({ fromDate: start, toDate: end }),
      subscriptionService.countActiveByPlan(end),
      aiAssistantService.getAiAnalytics({ fromDate: start, toDate: end, dateFormat, timeZone }),
      childService.getChildAgeGroupStats(),
      childService.countDistinctParentsWithActiveChildrenBeforeDate(end),
      connectionService.countDistinctParentsWithConnectionBeforeDate(end),
      playdateService.countDistinctParentsWithPlaydateBeforeDate(end),
    ]);

    // Format User Growth timeline
    const userGrowthMap = new Map(newParentsTimeline.map((r) => [r.period, r.count]));
    const userGrowthTimeline = buckets.map((period) => ({
      period,
      count: userGrowthMap.get(period) || 0,
    }));

    // Format Revenue timeline
    const revenueMap = new Map(revenueTimelineRows.map((r) => [r.period, r]));
    const revenueTimeline = buckets.map((period) => ({
      period,
      revenue: revenueMap.get(period)?.revenue || 0,
      transactionCount: revenueMap.get(period)?.transactionCount || 0,
    }));

    // Format Playdate timeline
    const playdateMap = new Map(playdateAnalytics.timeline.map((r) => [r.period, r.count]));
    const playdateTimeline = buckets.map((period) => ({
      period,
      count: playdateMap.get(period) || 0,
    }));

    // Format AI timeline
    const aiMap = new Map(aiAnalytics.timeline.map((r) => [r.period, r.count]));
    const aiTimeline = buckets.map((period) => ({
      period,
      count: aiMap.get(period) || 0,
    }));

    // Conversion Funnel
    const funnel = [
      { step: 'registered', label: 'Đăng ký tài khoản', count: totalParentsVal },
      { step: 'withChildProfile', label: 'Tạo hồ sơ bé', count: parentsWithChildrenCount },
      { step: 'firstConnection', label: 'Có kết nối', count: parentsWithConnectionCount },
      { step: 'firstPlaydate', label: 'Tham gia playdate', count: parentsWithPlaydateCount },
      { step: 'paid', label: 'Nâng cấp Premium', count: revenueMetricsVal.allTimePayingParents },
    ];

    const conversionRate = toPercent(revenueMetricsVal.allTimePayingParents, totalParentsVal);
    const churnRate = toPercent(revenueMetricsVal.churnedParents, revenueMetricsVal.premiumAtStart);

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
        conversionRate,
        churnRate,
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
        totalMessagesInPeriod: aiAnalytics.totalMessagesInPeriod,
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
    const { items, total } = await adminNotificationRepository.findPage({
      category: category && category !== 'all' ? category.toLowerCase() : undefined,
      severity: severity && severity !== 'all' ? severity.toLowerCase() : undefined,
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
    return adminNotificationRepository.countUnread(adminId);
  }

  /**
   * Mark single notification as read
   * @param {string} id
   * @param {string|ObjectId} adminId
   */
  async markNotificationAsRead(id, adminId) {
    const updated = await adminNotificationRepository.markAsRead(id, adminId);
    if (!updated) {
      throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
    }
    try {
      const adminIO = getAdminIO();
      if (adminIO) {
        const counts = await adminNotificationRepository.countUnread(adminId);
        adminIO.to('admins').emit('admin:notification:unread-count', counts);
      }
    } catch {
      // Non-blocking socket broadcast
    }
    return updated;
  }

  /**
   * Mark all notifications (or all in a category) as read
   * @param {string|ObjectId} adminId
   * @param {string} [category]
   */
  async markAllNotificationsAsRead(adminId, category) {
    const cat = category && category !== 'all' ? category.toLowerCase() : undefined;
    const result = await adminNotificationRepository.markAllAsRead(adminId, cat);
    try {
      const adminIO = getAdminIO();
      if (adminIO) {
        const counts = await adminNotificationRepository.countUnread(adminId);
        adminIO.to('admins').emit('admin:notification:unread-count', counts);
      }
    } catch {
      // Non-blocking socket broadcast
    }
    return result;
  }
}

export default new AdminService();
