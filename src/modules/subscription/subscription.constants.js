export const SUBSCRIPTION_PLAN_CODES = Object.freeze({
  FREE: 'free',
  PREMIUM_MONTHLY: 'premium_monthly',
  PREMIUM_YEARLY: 'premium_yearly',
});

export const BILLING_CYCLES = Object.freeze({
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  NONE: 'none',
});

export const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const PAYMENT_METHODS = Object.freeze({
  PAYOS: 'payos',
  VNPAY: 'vnpay',
  MOMO: 'momo',
  CREDIT_CARD: 'credit_card',
});

export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
});

export const QUOTA_PERIOD_TYPES = Object.freeze({
  DAILY: 'daily',
  MONTHLY: 'monthly',
});

export const SUBSCRIPTION_PLAN_DEFAULTS = Object.freeze([
  {
    planCode: SUBSCRIPTION_PLAN_CODES.FREE,
    name: 'Gói Miễn Phí (Free)',
    price: 0,
    currency: 'VND',
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
    name: 'Gói Cao Cấp Tháng (Premium Monthly)',
    price: 99000,
    currency: 'VND',
    billingCycle: BILLING_CYCLES.MONTHLY,
    features: {
      childProfilesLimit: -1, // Unlimited
      discoveryViewLimitPerDay: -1, // Unlimited
      connectionRequestsLimitPerMonth: -1, // Unlimited
      playdatesLimitPerMonth: -1, // Unlimited
      playdateParticipationLimitPerMonth: -1, // Unlimited
      aiAssistantLimitPerMonth: -1, // Unlimited
    },
    isActive: true,
  },
  {
    planCode: SUBSCRIPTION_PLAN_CODES.PREMIUM_YEARLY,
    name: 'Gói Cao Cấp Năm (Premium Yearly)',
    price: 990000,
    currency: 'VND',
    billingCycle: BILLING_CYCLES.YEARLY,
    features: {
      childProfilesLimit: -1, // Unlimited
      discoveryViewLimitPerDay: -1, // Unlimited
      connectionRequestsLimitPerMonth: -1, // Unlimited
      playdatesLimitPerMonth: -1, // Unlimited
      playdateParticipationLimitPerMonth: -1, // Unlimited
      aiAssistantLimitPerMonth: -1, // Unlimited
    },
    isActive: true,
  },
]);
