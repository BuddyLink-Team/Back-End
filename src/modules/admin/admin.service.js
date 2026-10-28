import userService from '../user/user.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import authService from '../auth/auth.service.js';
import subscriptionService from '../subscription/subscription.service.js';
import connectionService from '../connection/connection.service.js';
import playdateService from '../playdate/playdate.service.js';
import safetyService from '../safety/safety.service.js';
import AppError from '../../shared/exceptions/AppError.js';
import { USER_ROLES, PAGINATION } from '../../shared/constants/index.js';
import { CHILD_VISIBILITY, LOGIN_METHODS } from './admin.constants.js';
import {
  AdminUserListItemDTO,
  AdminUserDetailDTO,
  AdminChildListItemDTO,
  AdminChildDetailDTO,
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
}

export default new AdminService();
