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
      discoverySwipesLimitPerDay: 5,
      discoveryViewLimitPerDay: 5,
      connectionRequestsLimitPerMonth: 5,
      playdatesCreatedLimitPerMonth: 3,
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
      discoverySwipesLimitPerDay: -1, // Unlimited
      discoveryViewLimitPerDay: -1,
      connectionRequestsLimitPerMonth: -1,
      playdatesCreatedLimitPerMonth: -1, // Unlimited
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
      discoverySwipesLimitPerDay: -1, // Unlimited
      discoveryViewLimitPerDay: -1,
      connectionRequestsLimitPerMonth: -1,
      playdatesCreatedLimitPerMonth: -1, // Unlimited
      playdatesLimitPerMonth: -1,
      playdateParticipationLimitPerMonth: -1,
      aiAssistantLimitPerMonth: -1,
    },
    isActive: true,
  },
]);
