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
