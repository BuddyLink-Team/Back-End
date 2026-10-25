/**
 * Transform subscription plan document to Admin Plan DTO
 */
export const toPlanDto = (plan) => ({
  id: plan._id,
  planCode: plan.planCode,
  name: plan.name,
  price: plan.price,
  currency: plan.currency,
  durationMonths: plan.durationMonths,
  billingCycle: plan.billingCycle,
  features: plan.features,
  isActive: plan.isActive,
  isFree: plan.planCode === 'free',
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

/**
 * Transform subscription document to Admin Subscription DTO
 */
export const toSubscriptionDto = (sub) => ({
  id: sub._id,
  parent: {
    id: sub.parent?._id || sub.parentId,
    fullName: sub.parent?.fullName || '',
    avatarUrl: sub.parent?.avatarUrl || '',
    email: sub.parent?.email || '',
  },
  planCode: sub.planCode,
  status: sub.status,
  startDate: sub.startDate,
  endDate: sub.endDate,
  purchasedMonths: sub.purchasedMonths || 0,
  createdAt: sub.createdAt,
});

/**
 * Transform payment document to Admin Payment List item DTO
 */
export const toPaymentSummaryDto = (payment) => ({
  id: payment._id,
  orderCode: payment.orderCode,
  parent: {
    id: payment.parent?._id || payment.parentId,
    fullName: payment.parent?.fullName || '',
    avatarUrl: payment.parent?.avatarUrl || '',
    email: payment.parent?.email || '',
  },
  planSnapshot: payment.planSnapshot,
  amount: payment.amount,
  currency: payment.currency,
  status: payment.status,
  paymentMethod: payment.paymentMethod,
  effectivePeriod:
    payment.status === 'success' && payment.grantResult
      ? {
          effectiveStartDate: payment.grantResult.effectiveStartDate,
          effectiveEndDate: payment.grantResult.effectiveEndDate,
          monthsGranted: payment.grantResult.monthsGranted,
        }
      : null,
  paidAt: payment.paidAt,
  createdAt: payment.createdAt,
});

/**
 * Transform payment document to Admin Payment Detail DTO (checkoutUrl and qrCode omitted)
 */
export const toPaymentDetailDto = (payment) => ({
  id: payment._id,
  orderCode: payment.orderCode,
  transactionId: payment.transactionId,
  parent: {
    id: payment.parent?._id || payment.parentId,
    fullName: payment.parent?.fullName || '',
    avatarUrl: payment.parent?.avatarUrl || '',
    email: payment.parent?.email || '',
  },
  planSnapshot: payment.planSnapshot,
  amount: payment.amount,
  currency: payment.currency,
  status: payment.status,
  paymentMethod: payment.paymentMethod,
  bankInfo: payment.bankInfo,
  paidAt: payment.paidAt,
  fulfilledAt: payment.fulfilledAt,
  failureReason: payment.failureReason,
  grantResult: payment.grantResult,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});
