export const SUBSCRIPTION_PLAN_CODES = Object.freeze({
  FREE: 'free',
  PREMIUM_MONTHLY: 'premium_monthly',
  PREMIUM_YEARLY: 'premium_yearly',
});

export const BILLING_CYCLES = Object.freeze({
  NONE: 'none',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
});

export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  EXPIRED: 'expired',
});

export const PAYMENT_METHODS = Object.freeze({
  PAYOS: 'payos',
});

export const PAYMENT_STATUS = Object.freeze({
  CREATING: 'creating',
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const QUOTA_PERIOD_TYPES = Object.freeze({
  DAILY: 'daily',
  MONTHLY: 'monthly',
});

export const QUOTA_FEATURES = Object.freeze({
  CHILD_PROFILES: 'child_profiles',
  DISCOVERY_SWIPES: 'discovery_swipes',
  PLAYDATES_CREATED: 'playdates_created',
  CONNECTION_REQUESTS: 'connection_requests',
  PLAYDATES_PARTICIPATED: 'playdates_participated',
  AI_ASSISTANT: 'ai_assistant',
});

// Bounded actions checked by subscriptionService.checkAndConsumeQuota: quota period, usage counter
// (usage-quota.model.js) and the plan feature holding the limit (-1 = unlimited)
export const QUOTA_ACTIONS = Object.freeze({
  discovery: {
    feature: QUOTA_FEATURES.DISCOVERY_SWIPES,
    periodType: QUOTA_PERIOD_TYPES.DAILY,
    counterField: 'discoveryViews',
    limitKey: 'discoveryViewLimitPerDay',
    message: (limit) => `Daily discovery limit reached (${limit}). Upgrade to Premium for unlimited discovery.`,
  },
  connectionRequest: {
    feature: QUOTA_FEATURES.CONNECTION_REQUESTS,
    periodType: QUOTA_PERIOD_TYPES.MONTHLY,
    counterField: 'connectionRequests',
    limitKey: 'connectionRequestsLimitPerMonth',
    message: (limit) => `Monthly connection request limit reached (${limit}). Upgrade to Premium for unlimited requests.`,
  },
  playdateCreate: {
    feature: QUOTA_FEATURES.PLAYDATES_CREATED,
    periodType: QUOTA_PERIOD_TYPES.MONTHLY,
    counterField: 'playdatesCreated',
    limitKey: 'playdatesLimitPerMonth',
    message: (limit) => `Monthly playdate creation limit reached (${limit}). Upgrade to Premium for unlimited playdates.`,
  },
  playdateParticipate: {
    feature: QUOTA_FEATURES.PLAYDATES_PARTICIPATED,
    periodType: QUOTA_PERIOD_TYPES.MONTHLY,
    counterField: 'playdatesParticipated',
    limitKey: 'playdateParticipationLimitPerMonth',
    message: (limit) => `Monthly playdate participation limit reached (${limit}). Upgrade to Premium for unlimited playdates.`,
  },
  aiAssistant: {
    feature: QUOTA_FEATURES.AI_ASSISTANT,
    periodType: QUOTA_PERIOD_TYPES.MONTHLY,
    counterField: 'aiAssistantRequests',
    limitKey: 'aiAssistantLimitPerMonth',
    message: (limit) => `Monthly AI assistant limit reached (${limit}). Upgrade to Premium for unlimited requests.`,
  },
});

// Feature names accepted as action types (QUOTA_FEATURES -> QUOTA_ACTIONS key)
export const QUOTA_ACTION_ALIASES = Object.freeze({
  [QUOTA_FEATURES.DISCOVERY_SWIPES]: 'discovery',
  [QUOTA_FEATURES.PLAYDATES_CREATED]: 'playdateCreate',
  [QUOTA_FEATURES.CONNECTION_REQUESTS]: 'connectionRequest',
  [QUOTA_FEATURES.PLAYDATES_PARTICIPATED]: 'playdateParticipate',
  [QUOTA_FEATURES.AI_ASSISTANT]: 'aiAssistant',
});

export const SUBSCRIPTION_PLAN_DEFAULTS = Object.freeze([
  {
    planCode: SUBSCRIPTION_PLAN_CODES.FREE,
    name: 'Gói Miễn Phí (Free)',
    price: 0,
    currency: 'VND',
    durationMonths: 0,
    billingCycle: BILLING_CYCLES.NONE,
    features: {
      childProfilesLimit: 1,
      discoveryViewLimitPerDay: 5,
      connectionRequestsLimitPerMonth: 5,
      playdatesLimitPerMonth: 3,
      playdateParticipationLimitPerMonth: 3,
      aiAssistantLimitPerMonth: 5,
    },
    isActive: true,
  },
  {
    planCode: SUBSCRIPTION_PLAN_CODES.PREMIUM_MONTHLY,
    name: 'Gói Cao Cấp 1 Tháng (Premium Monthly)',
    price: 99000,
    currency: 'VND',
    durationMonths: 1,
    billingCycle: BILLING_CYCLES.MONTHLY,
    features: {
      childProfilesLimit: -1, // Unlimited
      discoveryViewLimitPerDay: -1,
      connectionRequestsLimitPerMonth: -1,
      playdatesLimitPerMonth: -1,
      playdateParticipationLimitPerMonth: -1,
      aiAssistantLimitPerMonth: -1,
    },
    isActive: true,
  },
  {
    planCode: SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY,
    name: 'Gói Cao Cấp 1 Năm (Premium Yearly)',
    price: 990000,
    currency: 'VND',
    durationMonths: 12,
    billingCycle: BILLING_CYCLES.YEARLY,
    features: {
      childProfilesLimit: -1, // Unlimited
      discoveryViewLimitPerDay: -1,
      connectionRequestsLimitPerMonth: -1,
      playdatesLimitPerMonth: -1,
      playdateParticipationLimitPerMonth: -1,
      aiAssistantLimitPerMonth: -1,
    },
    isActive: true,
  },
]);
