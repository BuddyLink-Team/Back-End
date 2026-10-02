export class SubscriptionDTO {
  static toPlanResponse(plan) {
    if (!plan) return null;
    return {
      planCode: plan.planCode,
      name: plan.name,
      price: plan.price,
      currency: plan.currency || 'VND',
      durationMonths: plan.durationMonths,
      billingCycle: plan.billingCycle,
      features: {
        childProfilesLimit: plan.features?.childProfilesLimit ?? 1,
        discoverySwipesLimitPerDay: plan.features?.discoverySwipesLimitPerDay ?? 5,
        playdatesCreatedLimitPerMonth: plan.features?.playdatesCreatedLimitPerMonth ?? 3,
      },
    };
  }

  static toPlanListResponse(plans) {
    if (!Array.isArray(plans)) return [];
    return plans.map(SubscriptionDTO.toPlanResponse);
  }

  static toCheckoutResponse(checkoutData) {
    if (!checkoutData) return null;
    return {
      orderCode: checkoutData.orderCode,
      status: checkoutData.status,
      planSnapshot: checkoutData.planSnapshot,
      amount: checkoutData.amount,
      currency: checkoutData.currency || 'VND',
      paymentLinkId: checkoutData.paymentLinkId || null,
      checkoutUrl: checkoutData.checkoutUrl || null,
      qrCode: checkoutData.qrCode || null,
      bankInfo: checkoutData.bankInfo || null,
      expiresAt: checkoutData.expiresAt || null,
    };
  }
}

export default SubscriptionDTO;
