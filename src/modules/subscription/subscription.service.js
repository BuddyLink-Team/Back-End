import mongoose from 'mongoose';
import subscriptionRepository from './subscription.repository.js';
import subscriptionPlanRepository from './subscription-plan.repository.js';
import usageQuotaRepository from './usage-quota.repository.js';
import paymentRepository from './payment.repository.js';
import payosAdapter from '../../integrations/payos/payos.adapter.js';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/AppError.js';
import {
  SUBSCRIPTION_PLAN_CODES,
  SUBSCRIPTION_STATUS,
  PAYMENT_STATUS,
  PAYMENT_METHODS,
  QUOTA_PERIOD_TYPES,
  QUOTA_FEATURES,
} from './subscription.constants.js';

/**
 * Helper to calculate calendar month expiration in Asia/Ho_Chi_Minh timezone
 * Preserves anchor day across variable month lengths (e.g. 31/01 -> 28/02 -> 31/03)
 * @param {Date} anchorDate Starting anchor date/time of the continuous subscription
 * @param {number} purchasedMonths Total continuous months purchased
 * @returns {Date} Expiration date timestamp in UTC
 */
export function calculateCalendarEndDate(anchorDate, purchasedMonths = 1) {
  const anchor = new Date(anchorDate);
  const vnAnchorStr = anchor.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
  const vnAnchor = new Date(vnAnchorStr);

  const anchorDay = vnAnchor.getDate();
  const anchorHours = vnAnchor.getHours();
  const anchorMinutes = vnAnchor.getMinutes();
  const anchorSeconds = vnAnchor.getSeconds();

  const totalMonths = vnAnchor.getMonth() + purchasedMonths;
  const targetYear = vnAnchor.getFullYear() + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const effectiveDay = Math.min(anchorDay, daysInTargetMonth);

  const yyyy = targetYear;
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(effectiveDay).padStart(2, '0');
  const hh = String(anchorHours).padStart(2, '0');
  const min = String(anchorMinutes).padStart(2, '0');
  const ss = String(anchorSeconds).padStart(2, '0');

  const isoWithVnOffset = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+07:00`;
  return new Date(isoWithVnOffset);
}

/**
 * Helper to get Vietnam timezone period strings
 * @param {'daily'|'monthly'} periodType
 * @param {Date} date
 */
export function getVietnamPeriodValue(periodType, date = new Date()) {
  const vnDateStr = date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
  const vnDate = new Date(vnDateStr);

  const yyyy = vnDate.getFullYear();
  const mm = String(vnDate.getMonth() + 1).padStart(2, '0');
  if (periodType === QUOTA_PERIOD_TYPES.MONTHLY) {
    return `${yyyy}-${mm}`;
  }
  const dd = String(vnDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Helper to get next reset timestamp for daily or monthly quotas (in UTC)
 * @param {'daily'|'monthly'} periodType
 */
export function getNextResetTime(periodType) {
  const now = new Date();
  const vnNowStr = now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
  const vnNow = new Date(vnNowStr);

  if (periodType === QUOTA_PERIOD_TYPES.DAILY) {
    const nextDay = new Date(vnNow.getFullYear(), vnNow.getMonth(), vnNow.getDate() + 1);
    const yyyy = nextDay.getFullYear();
    const mm = String(nextDay.getMonth() + 1).padStart(2, '0');
    const dd = String(nextDay.getDate()).padStart(2, '0');
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00+07:00`);
  }

  if (periodType === QUOTA_PERIOD_TYPES.MONTHLY) {
    const nextMonth = new Date(vnNow.getFullYear(), vnNow.getMonth() + 1, 1);
    const yyyy = nextMonth.getFullYear();
    const mm = String(nextMonth.getMonth() + 1).padStart(2, '0');
    const dd = String(nextMonth.getDate()).padStart(2, '0');
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00+07:00`);
  }

  return null;
}

class SubscriptionService {
  /**
   * Seed default subscription plans into database
   */
  async seedSubscriptionPlans() {
    return subscriptionPlanRepository.seedDefaultPlans();
  }

  /**
   * Get all active subscription plans
   */
  async getActivePlans() {
    return subscriptionPlanRepository.findAllActive();
  }

  /**
   * Get subscription plan by code
   * @param {string} planCode
   */
  async getPlanByCode(planCode) {
    return subscriptionPlanRepository.findByPlanCode(planCode);
  }

  /**
   * Create default Free subscription for a parent
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async createFreeSubscription(parentId) {
    return subscriptionRepository.upsertFreeSubscription(parentId);
  }

  /**
   * Check if a subscription document is currently active with Premium benefits
   * @param {Object} subscription
   */
  isSubscriptionActive(subscription) {
    if (!subscription) return false;
    if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) return false;
    if (subscription.planCode === SUBSCRIPTION_PLAN_CODES.FREE) return false;
    if (!subscription.endDate) return false;
    return new Date(subscription.endDate) > new Date();
  }

  /**
   * Get subscription by parentId (auto-upserts Free if not found)
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {mongoose.ClientSession} session
   */
  async getSubscriptionByParentId(parentId, session = null) {
    let sub = await subscriptionRepository.findByParentId(parentId, session);
    if (!sub) {
      sub = await subscriptionRepository.upsertFreeSubscription(parentId, session);
    }
    return sub;
  }

  /**
   * Get parent effective subscription status and usage quota details
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {number} currentChildCount
   */
  async getMySubscriptionQuota(parentId, currentChildCount = 0) {
    const subscription = await this.getSubscriptionByParentId(parentId);
    const isPremium = this.isSubscriptionActive(subscription);
    const effectivePlanCode = isPremium ? subscription.planCode : SUBSCRIPTION_PLAN_CODES.FREE;

    const todayStr = getVietnamPeriodValue(QUOTA_PERIOD_TYPES.DAILY);
    const thisMonthStr = getVietnamPeriodValue(QUOTA_PERIOD_TYPES.MONTHLY);

    const [dailyCounters, monthlyCounters] = await Promise.all([
      usageQuotaRepository.getCounters(parentId, QUOTA_PERIOD_TYPES.DAILY, todayStr),
      usageQuotaRepository.getCounters(parentId, QUOTA_PERIOD_TYPES.MONTHLY, thisMonthStr),
    ]);

    const activePlan = await subscriptionPlanRepository.findByPlanCode(effectivePlanCode);
    const features = activePlan?.features || {
      childProfilesLimit: 1,
      discoverySwipesLimitPerDay: 5,
      playdatesCreatedLimitPerMonth: 3,
    };

    const discoveryUsed = dailyCounters.discoverySwipes || 0;
    const playdatesUsed = monthlyCounters.playdatesCreated || 0;

    return {
      isPremium,
      effectivePlanCode,
      subscription: {
        _id: subscription._id,
        planCode: subscription.planCode,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        calendarAnchorAt: subscription.calendarAnchorAt,
        purchasedMonths: subscription.purchasedMonths,
      },
      usage: {
        [QUOTA_FEATURES.CHILD_PROFILES]: {
          limit: isPremium ? -1 : features.childProfilesLimit,
          used: currentChildCount,
          remaining: isPremium ? null : Math.max(0, features.childProfilesLimit - currentChildCount),
          periodType: null,
          resetAt: null,
        },
        [QUOTA_FEATURES.DISCOVERY_SWIPES]: {
          limit: isPremium ? -1 : features.discoverySwipesLimitPerDay,
          used: discoveryUsed,
          remaining: isPremium ? null : Math.max(0, features.discoverySwipesLimitPerDay - discoveryUsed),
          periodType: QUOTA_PERIOD_TYPES.DAILY,
          resetAt: getNextResetTime(QUOTA_PERIOD_TYPES.DAILY),
        },
        [QUOTA_FEATURES.PLAYDATES_CREATED]: {
          limit: isPremium ? -1 : features.playdatesCreatedLimitPerMonth,
          used: playdatesUsed,
          remaining: isPremium ? null : Math.max(0, features.playdatesCreatedLimitPerMonth - playdatesUsed),
          periodType: QUOTA_PERIOD_TYPES.MONTHLY,
          resetAt: getNextResetTime(QUOTA_PERIOD_TYPES.MONTHLY),
        },
      },
    };
  }

  /**
   * Create a PayOS checkout session for a parent
   * Saves Payment record in database BEFORE calling PayOS
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {Object} payload
   * @param {string} payload.planCode
   * @param {string} [payload.idempotencyKey]
   * @param {string} [payload.fingerprint]
   */
  async createCheckoutSession(parentId, { planCode, idempotencyKey = null, fingerprint = null }) {
    if (!planCode || planCode === SUBSCRIPTION_PLAN_CODES.FREE) {
      throw new AppError('Gói cước nâng cấp không hợp lệ hoặc miễn phí', 400, 'INVALID_PLAN');
    }

    const plan = await subscriptionPlanRepository.findByPlanCode(planCode);
    if (!plan || !plan.isActive || plan.price <= 0) {
      throw new AppError('Gói dịch vụ không tồn tại hoặc đã ngừng mở bán', 400, 'PLAN_NOT_AVAILABLE');
    }

    // 1. Check idempotency key if provided
    if (idempotencyKey) {
      const existingPayment = await paymentRepository.findByParentAndIdempotencyKey(
        parentId,
        idempotencyKey
      );

      if (existingPayment) {
        if (existingPayment.planSnapshot.planCode !== planCode) {
          throw new AppError(
            'Idempotency-Key đã được sử dụng cho một gói cước khác',
            409,
            'IDEMPOTENCY_CONFLICT'
          );
        }

        // If existingPayment is an old mock payment and adapter is now live, mark it cancelled
        const isMockPayment = existingPayment.paymentLinkId?.startsWith('mock_');
        const isExpiredPayment =
          existingPayment.status === PAYMENT_STATUS.PENDING &&
          existingPayment.expiresAt &&
          new Date(existingPayment.expiresAt) < new Date();

        if (payosAdapter.isLive() && isMockPayment) {
          await paymentRepository.updateNonSuccessStatus(existingPayment.orderCode, {
            status: PAYMENT_STATUS.CANCELLED,
            failureReason: 'Cancelled old mock payment session for live PayOS',
          });
        } else if (isExpiredPayment) {
          await paymentRepository.updateNonSuccessStatus(existingPayment.orderCode, {
            status: PAYMENT_STATUS.EXPIRED,
            failureReason: 'Payment session expired',
          });
        } else {
          // FR-01: Reconcile and recover link/QR if order is in 'creating' or missing checkoutUrl
          if (
            existingPayment.status === PAYMENT_STATUS.CREATING ||
            !existingPayment.checkoutUrl
          ) {
            let payosInfo = null;
            try {
              payosInfo = await payosAdapter.getPaymentLinkInformation(existingPayment.orderCode);
            } catch (e) {
              // PayOS might not have the link yet
            }

            if (payosInfo && payosInfo.status === 'PAID') {
              const fulfillment = await this.fulfillPaymentSession(existingPayment.orderCode, payosInfo);
              const fulfilled = fulfillment.payment || existingPayment;
              return {
                orderCode: fulfilled.orderCode,
                status: PAYMENT_STATUS.SUCCESS,
                planSnapshot: fulfilled.planSnapshot,
                amount: fulfilled.amount,
                currency: fulfilled.currency,
                paymentLinkId: fulfilled.paymentLinkId,
                checkoutUrl: fulfilled.checkoutUrl,
                qrCode: fulfilled.qrCode,
                bankInfo: fulfilled.bankInfo,
                expiresAt: fulfilled.expiresAt,
                isExisting: true,
              };
            } else if (payosInfo && payosInfo.status === 'PENDING') {
              const description = `BL${existingPayment.orderCode}`.slice(0, 25);
              const bankInfo =
                payosInfo.bin || payosInfo.accountNumber
                  ? {
                      bin: payosInfo.bin || null,
                      accountNumber: payosInfo.accountNumber || null,
                      accountName: payosInfo.accountName || null,
                      description,
                    }
                  : existingPayment.bankInfo;

              const updated = await paymentRepository.updateById(existingPayment._id, {
                status: PAYMENT_STATUS.PENDING,
                paymentLinkId: payosInfo.id || payosInfo.paymentLinkId || existingPayment.paymentLinkId,
                checkoutUrl: payosInfo.checkoutUrl || existingPayment.checkoutUrl,
                qrCode: payosInfo.qrCode || existingPayment.qrCode,
                bankInfo,
              });

              return {
                orderCode: updated.orderCode,
                status: updated.status,
                planSnapshot: updated.planSnapshot,
                amount: updated.amount,
                currency: updated.currency,
                paymentLinkId: updated.paymentLinkId,
                checkoutUrl: updated.checkoutUrl,
                qrCode: updated.qrCode,
                bankInfo: updated.bankInfo,
                expiresAt: updated.expiresAt,
                isExisting: true,
              };
            } else if (!existingPayment.checkoutUrl) {
              // Re-create payment link using same orderCode without duplicate records
              const description = `BL${existingPayment.orderCode}`.slice(0, 25);
              const returnUrl = `${env.PAYOS.RETURN_URL}?orderCode=${existingPayment.orderCode}`;
              const cancelUrl = `${env.PAYOS.CANCEL_URL}?orderCode=${existingPayment.orderCode}`;
              const payosResponse = await payosAdapter.createPaymentLink({
                orderCode: existingPayment.orderCode,
                amount: plan.price,
                description,
                cancelUrl,
                returnUrl,
                expiredAt: Math.floor(existingPayment.expiresAt.getTime() / 1000),
                items: [
                  {
                    name: plan.name,
                    quantity: 1,
                    price: plan.price,
                  },
                ],
              });

              const bankInfo =
                payosResponse.bin || payosResponse.accountNumber
                  ? {
                      bin: payosResponse.bin || null,
                      accountNumber: payosResponse.accountNumber || null,
                      accountName: payosResponse.accountName || null,
                      description,
                    }
                  : null;

              const updated = await paymentRepository.updateById(existingPayment._id, {
                status: PAYMENT_STATUS.PENDING,
                paymentLinkId: payosResponse.paymentLinkId || null,
                checkoutUrl: payosResponse.checkoutUrl || null,
                qrCode: payosResponse.qrCode || null,
                bankInfo,
              });

              return {
                orderCode: updated.orderCode,
                status: updated.status,
                planSnapshot: updated.planSnapshot,
                amount: updated.amount,
                currency: updated.currency,
                paymentLinkId: updated.paymentLinkId,
                checkoutUrl: updated.checkoutUrl,
                qrCode: updated.qrCode,
                bankInfo: updated.bankInfo,
                expiresAt: updated.expiresAt,
                isExisting: true,
              };
            }
          }

          // Return existing payment details if still pending/valid
          if (existingPayment.status === PAYMENT_STATUS.PENDING) {
            return {
              orderCode: existingPayment.orderCode,
              status: existingPayment.status,
              planSnapshot: existingPayment.planSnapshot,
              amount: existingPayment.amount,
              currency: existingPayment.currency,
              paymentLinkId: existingPayment.paymentLinkId,
              checkoutUrl: existingPayment.checkoutUrl,
              qrCode: existingPayment.qrCode,
              bankInfo: existingPayment.bankInfo,
              expiresAt: existingPayment.expiresAt,
              isExisting: true,
            };
          }
        }
      }
    }

    // 2. Generate unique safe integer orderCode
    let orderCode;
    let payment;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes expiration

    for (let attempt = 0; attempt < 5; attempt++) {
      orderCode = Number(String(Date.now()).slice(-6) + Math.floor(100 + Math.random() * 900));
      try {
        // Step 1: SAVE PAYMENT BEFORE CALLING PAYOS
        payment = await paymentRepository.create({
          parentId,
          orderCode,
          idempotencyKey,
          fingerprint,
          planSnapshot: {
            planCode: plan.planCode,
            name: plan.name,
            price: plan.price,
            currency: plan.currency || 'VND',
            durationMonths: plan.durationMonths || 1,
          },
          amount: plan.price,
          currency: plan.currency || 'VND',
          paymentMethod: PAYMENT_METHODS.PAYOS,
          status: PAYMENT_STATUS.CREATING,
          expiresAt,
        });
        break;
      } catch (err) {
        if (err.code === 11000) {
          const isIdempotencyCollision =
            Boolean(idempotencyKey) &&
            (Boolean(err.keyPattern?.idempotencyKey) ||
              err.message?.includes('idempotencyKey') ||
              err.message?.includes('parentId_1_idempotencyKey_1'));

          if (isIdempotencyCollision) {
            const existing = await paymentRepository.findByParentAndIdempotencyKey(
              parentId,
              idempotencyKey
            );
            if (existing) {
              if (existing.planSnapshot.planCode !== planCode) {
                throw new AppError(
                  'Idempotency-Key đã được sử dụng cho một gói cước khác',
                  409,
                  'IDEMPOTENCY_CONFLICT'
                );
              }
              return {
                orderCode: existing.orderCode,
                status: existing.status,
                planSnapshot: existing.planSnapshot,
                amount: existing.amount,
                currency: existing.currency,
                paymentLinkId: existing.paymentLinkId,
                checkoutUrl: existing.checkoutUrl,
                qrCode: existing.qrCode,
                bankInfo: existing.bankInfo,
                expiresAt: existing.expiresAt,
                isExisting: true,
              };
            }
          }
          if (attempt < 4) continue; // Retry with new orderCode on orderCode collision
        }
        throw err;
      }
    }

    if (!payment) {
      throw new AppError('Không thể khởi tạo mã đơn hàng', 500, 'ORDER_CREATION_FAILED');
    }

    // 3. Prepare description & URLs for PayOS
    const description = `BL${orderCode}`.slice(0, 25);
    const returnUrl = `${env.PAYOS.RETURN_URL}?orderCode=${orderCode}`;
    const cancelUrl = `${env.PAYOS.CANCEL_URL}?orderCode=${orderCode}`;

    // 4. Call PayOS outside DB transaction
    try {
      const payosResponse = await payosAdapter.createPaymentLink({
        orderCode,
        amount: plan.price,
        description,
        cancelUrl,
        returnUrl,
        expiredAt: Math.floor(expiresAt.getTime() / 1000),
        items: [
          {
            name: plan.name,
            quantity: 1,
            price: plan.price,
          },
        ],
      });

      // Step 2: On PayOS success, update Payment with link info and change status to 'pending'
      // Note: Do not overwrite status if webhook already marked it as 'success'
      const freshPayment = await paymentRepository.findById(payment._id);
      const newStatus =
        freshPayment?.status === PAYMENT_STATUS.SUCCESS
          ? PAYMENT_STATUS.SUCCESS
          : PAYMENT_STATUS.PENDING;

      const bankInfo =
        payosResponse.bin || payosResponse.accountNumber
          ? {
              bin: payosResponse.bin || null,
              accountNumber: payosResponse.accountNumber || null,
              accountName: payosResponse.accountName || null,
              description,
            }
          : null;

      await paymentRepository.updateById(payment._id, {
        status: newStatus,
        paymentLinkId: payosResponse.paymentLinkId || null,
        checkoutUrl: payosResponse.checkoutUrl || null,
        qrCode: payosResponse.qrCode || null,
        bankInfo,
      });

      return {
        orderCode,
        status: newStatus,
        planSnapshot: payment.planSnapshot,
        amount: plan.price,
        currency: plan.currency || 'VND',
        paymentLinkId: payosResponse.paymentLinkId,
        checkoutUrl: payosResponse.checkoutUrl,
        qrCode: payosResponse.qrCode,
        bankInfo,
        expiresAt,
      };
    } catch (payosError) {
      logger.error(`Failed to create PayOS link for order ${orderCode}: ${payosError.message}`);

      // FR-01: Timeout / Network errors keep status as 'creating' for reconciliation; definite client errors mark 'failed'
      const isDefiniteRejection =
        payosError.statusCode === 400 || payosError.statusCode === 422;

      if (isDefiniteRejection) {
        await paymentRepository.updateById(payment._id, {
          status: PAYMENT_STATUS.FAILED,
          failureReason: payosError.message,
        });
      } else {
        await paymentRepository.updateById(payment._id, {
          failureReason: `PayOS call pending/timeout: ${payosError.message}`,
        });
      }

      throw payosError;
    }
  }

  /**
   * Core atomic payment fulfillment method
   * Shared by both Webhook IPN and Verify API
   * Runs in a MongoDB session transaction with retry support
   * @param {number|string} orderCode
   * @param {Object} paymentData Verified payment details from PayOS
   */
  async fulfillPaymentSession(orderCode, paymentData = {}) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let session = null;
      try {
        const topologyType = mongoose.connection?.client?.topology?.description?.type;
        const isReplicaSet =
          topologyType === 'ReplicaSetWithPrimary' ||
          topologyType === 'ReplicaSetNoPrimary' ||
          topologyType === 'Sharded';
        if (isReplicaSet) {
          session = await mongoose.startSession();
          session.startTransaction();
        }
      } catch (sessionErr) {
        session = null;
      }

      try {
        // 1. Find payment by orderCode
        const payment = await paymentRepository.findByOrderCode(orderCode, session);
        if (!payment) {
          if (session) {
            await session.abortTransaction();
            session.endSession();
          }
          return {
            alreadyProcessed: false,
            success: false,
            message: 'Payment record not found',
          };
        }

        // 2. Idempotency: If already fulfilled with success, return immediately
        if (payment.status === PAYMENT_STATUS.SUCCESS && payment.fulfilledAt) {
          if (session) {
            await session.commitTransaction();
            session.endSession();
          }
          return {
            alreadyProcessed: true,
            success: true,
            payment,
          };
        }

        // 3. Strict verification of amount, paymentLinkId, currency, and code
        if (paymentData.amount === undefined || paymentData.amount === null) {
          throw new AppError('Dữ liệu thanh toán thiếu số tiền', 400, 'INVALID_PAYMENT_DATA');
        }

        if (Number(paymentData.amount) !== Number(payment.amount)) {
          logger.error(
            `Amount mismatch for order ${orderCode}: received ${paymentData.amount}, expected ${payment.amount}`
          );
          throw new AppError('Số tiền thanh toán không khớp với đơn hàng', 400, 'AMOUNT_MISMATCH');
        }

        if (paymentData.currency && paymentData.currency !== (payment.currency || 'VND')) {
          throw new AppError('Đơn vị tiền tệ không khớp với đơn hàng', 400, 'CURRENCY_MISMATCH');
        }

        if (payment.paymentLinkId && paymentData.paymentLinkId) {
          if (payment.paymentLinkId !== paymentData.paymentLinkId) {
            throw new AppError('Mã liên kết thanh toán không khớp', 400, 'PAYMENT_LINK_MISMATCH');
          }
        }

        // 4. Calculate and grant subscription extension using Calendar Month rules
        const now = new Date();
        const durationMonths = payment.planSnapshot?.durationMonths || 1;
        let subscription = await subscriptionRepository.findByParentId(payment.parentId, session);

        const isCurrentlyActive = this.isSubscriptionActive(subscription);
        let startDate = now;
        let calendarAnchorAt = now;
        let purchasedMonths = durationMonths;

        if (isCurrentlyActive && subscription?.calendarAnchorAt) {
          // Continuous cycle: retain anchor date and add months
          startDate = subscription.startDate;
          calendarAnchorAt = subscription.calendarAnchorAt;
          purchasedMonths = (subscription.purchasedMonths || 0) + durationMonths;
        }

        const endDate = calculateCalendarEndDate(calendarAnchorAt, purchasedMonths);

        // Update / Upsert Subscription via repository (No direct .save())
        const subData = {
          parentId: payment.parentId,
          planCode: payment.planSnapshot.planCode,
          status: SUBSCRIPTION_STATUS.ACTIVE,
          startDate,
          endDate,
          calendarAnchorAt,
          purchasedMonths,
          lastPaymentId: payment._id,
        };
        const updatedSub = await subscriptionRepository.upsertSubscription(
          payment.parentId,
          subData,
          session
        );

        // 5. Update Payment conditionally via repository (No direct .save())
        const paidAt =
          paymentData.paidAt || paymentData.transactionDateTime
            ? new Date(paymentData.paidAt || paymentData.transactionDateTime)
            : now;

        const paymentUpdateData = {
          status: PAYMENT_STATUS.SUCCESS,
          paidAt,
          fulfilledAt: now,
          transactionId: paymentData.reference || paymentData.transactionId || String(orderCode),
          subscriptionId: updatedSub._id,
          paymentLinkId: payment.paymentLinkId || paymentData.paymentLinkId || null,
          rawWebhookData: paymentData,
          grantResult: {
            effectiveStartDate: startDate,
            effectiveEndDate: endDate,
            monthsGranted: durationMonths,
          },
        };

        const fulfilledPayment = await paymentRepository.fulfillPayment(
          orderCode,
          paymentUpdateData,
          session
        );

        if (!fulfilledPayment) {
          // Concurrently fulfilled by another request
          if (session) {
            await session.abortTransaction();
            session.endSession();
          }
          const latestPayment = await paymentRepository.findByOrderCode(orderCode);
          return {
            alreadyProcessed: true,
            success: true,
            payment: latestPayment,
          };
        }

        if (session) {
          await session.commitTransaction();
          session.endSession();
        }

        logger.info(
          `Successfully fulfilled payment ${orderCode} for parent ${payment.parentId}. New endDate: ${endDate.toISOString()}`
        );

        return {
          alreadyProcessed: false,
          success: true,
          payment: fulfilledPayment,
          subscription: updatedSub,
        };
      } catch (error) {
        if (session) {
          try {
            await session.abortTransaction();
          } catch (e) {}
          session.endSession();
        }

        // Check for transient transaction conflict
        const isTransient =
          error.hasErrorLabel?.('TransientTransactionError') ||
          error.code === 112 ||
          error.message?.includes('WriteConflict');

        if (isTransient && attempt < maxRetries) {
          logger.warn(`Transaction conflict on order ${orderCode}, retrying attempt ${attempt + 1}...`);
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Handle PayOS Webhook IPN
   * @param {Object} webhookBody
   */
  async handlePayOSWebhook(webhookBody) {
    logger.info(`Received PayOS Webhook payload: ${JSON.stringify(webhookBody)}`);

    // Verify webhook signature
    const verifiedData = payosAdapter.verifyPaymentWebhookData(webhookBody);
    const { orderCode, code, desc } = verifiedData;

    // Handle PayOS test webhook validation samples (e.g. orderCode = 123)
    if (orderCode === 123 || verifiedData.isTest) {
      logger.info('Received PayOS webhook validation ping sample.');
      return { success: true, message: 'Test webhook acknowledged' };
    }

    if (!orderCode) {
      throw new AppError('Dữ liệu webhook thiếu orderCode', 400, 'INVALID_WEBHOOK_PAYLOAD');
    }

    const isSuccess =
      code === '00' ||
      code === 0 ||
      webhookBody.success === true ||
      verifiedData.status === 'PAID';

    if (isSuccess) {
      return this.fulfillPaymentSession(orderCode, verifiedData);
    } else {
      // FR-03: Never downgrade an already success payment
      await paymentRepository.updateNonSuccessStatus(orderCode, {
        status: PAYMENT_STATUS.FAILED,
        failureReason: desc || 'Payment failed or cancelled via PayOS Webhook',
        rawWebhookData: verifiedData,
      });
      return { success: false, message: desc || 'Payment failed' };
    }
  }

  /**
   * Verify and reconcile payment status by orderCode
   * Throttles live PayOS reconciliation to max once per 10 seconds per order
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {number|string} orderCode
   */
  async verifyPayment(parentId, orderCode) {
    const payment = await paymentRepository.findByOrderCode(orderCode);
    if (!payment || String(payment.parentId) !== String(parentId)) {
      throw new AppError('Không tìm thấy thông tin đơn hàng', 404, 'PAYMENT_NOT_FOUND');
    }

    // FR-04: If already success, return current result; never downgrade success
    if (payment.status === PAYMENT_STATUS.SUCCESS && payment.fulfilledAt) {
      return {
        orderCode: payment.orderCode,
        status: payment.status,
        amount: payment.amount,
        planSnapshot: payment.planSnapshot,
        paidAt: payment.paidAt,
        fulfilledAt: payment.fulfilledAt,
        grantResult: payment.grantResult,
        bankInfo: payment.bankInfo,
        qrCode: payment.qrCode,
        checkoutUrl: payment.checkoutUrl,
      };
    }

    // Reconcile with PayOS if not reconciled in last 10 seconds
    const isMockPayment = payment.paymentLinkId?.startsWith('mock_');
    const isExpired = payment.expiresAt && new Date(payment.expiresAt) < new Date();

    if (isMockPayment && payosAdapter.isLive()) {
      if (isExpired && payment.status === PAYMENT_STATUS.PENDING) {
        await paymentRepository.updateNonSuccessStatus(payment.orderCode, {
          status: PAYMENT_STATUS.EXPIRED,
          failureReason: 'Mock payment session expired',
        });
        payment.status = PAYMENT_STATUS.EXPIRED;
      }
    } else {
      const now = Date.now();
      const lastReconciled = payment.lastReconciledAt ? payment.lastReconciledAt.getTime() : 0;
      const shouldReconcile = now - lastReconciled >= 10000;

      if (shouldReconcile) {
        await paymentRepository.updateById(payment._id, { lastReconciledAt: new Date() });
        try {
          const payosInfo = await payosAdapter.getPaymentLinkInformation(orderCode);
          if (payosInfo && (payosInfo.status === 'PAID' || payosInfo.status === 'success')) {
            const fulfillment = await this.fulfillPaymentSession(orderCode, payosInfo);
            return {
              orderCode: payment.orderCode,
              status: PAYMENT_STATUS.SUCCESS,
              amount: payment.amount,
              planSnapshot: payment.planSnapshot,
              paidAt: fulfillment.payment?.paidAt || new Date(),
              fulfilledAt: fulfillment.payment?.fulfilledAt || new Date(),
              grantResult: fulfillment.payment?.grantResult,
              bankInfo: payment.bankInfo,
              qrCode: payment.qrCode,
              checkoutUrl: payment.checkoutUrl,
            };
          } else if (payosInfo && (payosInfo.status === 'CANCELLED' || payosInfo.status === 'EXPIRED')) {
            const mappedStatus =
              payosInfo.status === 'CANCELLED'
                ? PAYMENT_STATUS.CANCELLED
                : PAYMENT_STATUS.EXPIRED;
            await paymentRepository.updateNonSuccessStatus(payment.orderCode, { status: mappedStatus });
            payment.status = mappedStatus;
          }
        } catch (err) {
          if (err.statusCode === 404 && isExpired) {
            await paymentRepository.updateNonSuccessStatus(payment.orderCode, {
              status: PAYMENT_STATUS.EXPIRED,
              failureReason: 'Payment order expired and not found on PayOS',
            });
            payment.status = PAYMENT_STATUS.EXPIRED;
          }
          logger.warn(`Could not reconcile order ${orderCode} with PayOS: ${err.message}`);
        }
      }
    }

    return {
      orderCode: payment.orderCode,
      status: payment.status,
      amount: payment.amount,
      planSnapshot: payment.planSnapshot,
      bankInfo: payment.bankInfo,
      qrCode: payment.qrCode,
      checkoutUrl: payment.checkoutUrl,
      expiresAt: payment.expiresAt,
    };
  }


  /**
   * Get paginated payment history for a parent
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {Object} queryOptions
   */
  async getPaymentHistory(parentId, { page = 1, limit = 10 } = {}) {
    const result = await paymentRepository.findHistoryByParentId(parentId, { page, limit });
    const formattedItems = result.items.map((item) => ({
      orderCode: item.orderCode,
      planName: item.planSnapshot?.name || 'Gói Premium',
      planCode: item.planSnapshot?.planCode || item.planCode,
      amount: item.amount,
      currency: item.currency,
      status: item.status,
      paidAt: item.paidAt,
      createdAt: item.createdAt,
      grantResult: item.grantResult,
    }));

    return {
      items: formattedItems,
      pagination: result.pagination,
    };
  }

  /**
   * Check if parent has reached child profiles limit
   * Enforces 1 child profile limit for Free tier
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {number} currentChildCount
   * @param {mongoose.ClientSession} [session]
   */
  async checkChildProfileQuota(parentId, currentChildCount = 0, session = null) {
    const subscription = await this.getSubscriptionByParentId(parentId, session);
    const isPremium = this.isSubscriptionActive(subscription);

    if (isPremium) {
      return { allowed: true, limit: -1, currentUsed: currentChildCount };
    }

    const freeLimit = 1;
    if (currentChildCount >= freeLimit) {
      throw new AppError(
        'Bạn đã tạo tối đa 1 hồ sơ bé trong gói Miễn phí. Nâng cấp Premium để tạo không giới hạn!',
        403,
        'CHILD_QUOTA_EXCEEDED',
        {
          feature: QUOTA_FEATURES.CHILD_PROFILES,
          limit: freeLimit,
          currentUsed: currentChildCount,
          periodType: null,
          resetAt: null,
        }
      );
    }

    return { allowed: true, limit: freeLimit, currentUsed: currentChildCount };
  }

  /**
   * Atomically check and consume quota for bounded actions
   * Supports 'discovery_swipes' and 'playdates_created'
   * @param {string|mongoose.Types.ObjectId} parentId
   * @param {'discovery_swipes'|'playdates_created'} feature
   * @param {boolean} consume
   */
  async checkAndConsumeQuota(parentId, feature, consume = true) {
    const subscription = await this.getSubscriptionByParentId(parentId);
    const isPremium = this.isSubscriptionActive(subscription);

    let periodType;
    let periodValue;
    let counterField;
    let limit;
    let message;

    if (feature === QUOTA_FEATURES.DISCOVERY_SWIPES || feature === 'discovery') {
      periodType = QUOTA_PERIOD_TYPES.DAILY;
      periodValue = getVietnamPeriodValue(QUOTA_PERIOD_TYPES.DAILY);
      counterField = 'discoverySwipes';
      limit = isPremium ? -1 : 5;
      message = 'Bạn đã dùng hết 5 lượt quẹt hôm nay. Nâng cấp Premium để tiếp tục.';
    } else if (feature === QUOTA_FEATURES.PLAYDATES_CREATED || feature === 'playdateCreate') {
      periodType = QUOTA_PERIOD_TYPES.MONTHLY;
      periodValue = getVietnamPeriodValue(QUOTA_PERIOD_TYPES.MONTHLY);
      counterField = 'playdatesCreated';
      limit = isPremium ? -1 : 3;
      message = 'Bạn đã tạo tối đa 3 cuộc hẹn chơi trong tháng này. Nâng cấp Premium để tạo không giới hạn!';
    } else {
      throw new AppError(`Tính năng quota không xác định: ${feature}`, 400, 'INVALID_QUOTA_FEATURE');
    }

    if (isPremium) {
      if (consume) {
        await usageQuotaRepository.incrementCounter(parentId, periodType, periodValue, counterField, 1);
      }
      return { allowed: true, limit: -1, currentUsed: 0 };
    }

    if (!consume) {
      const counters = await usageQuotaRepository.getCounters(parentId, periodType, periodValue);
      const used = counters[counterField] || 0;
      if (used >= limit) {
        throw new AppError(message, 403, 'QUOTA_EXCEEDED', {
          feature,
          limit,
          currentUsed: used,
          periodType,
          resetAt: getNextResetTime(periodType),
        });
      }
      return { allowed: true, limit, currentUsed: used };
    }

    // Atomic check and consume
    const result = await usageQuotaRepository.atomicCheckAndConsume(
      parentId,
      periodType,
      periodValue,
      counterField,
      limit
    );

    if (!result.allowed) {
      throw new AppError(message, 403, 'QUOTA_EXCEEDED', {
        feature,
        limit,
        currentUsed: result.currentUsed,
        periodType,
        resetAt: getNextResetTime(periodType),
      });
    }

    const remaining = limit === -1 ? null : Math.max(0, limit - result.currentUsed);

    return {
      allowed: true,
      limit,
      currentUsed: result.currentUsed,
      remaining,
    };
  }

  /**
   * Helper for quota summary representation
   * @param {string|mongoose.Types.ObjectId} parentId
   */
  async getQuotaSummary(parentId) {
    const quotaData = await this.getMySubscriptionQuota(parentId, 0);
    return {
      planCode: quotaData.effectivePlanCode,
      isPremium: quotaData.isPremium,
      limits: {
        discoveryViewsPerDay: quotaData.usage?.[QUOTA_FEATURES.DISCOVERY_SWIPES]?.limit ?? 5,
        childProfiles: quotaData.usage?.[QUOTA_FEATURES.CHILD_PROFILES]?.limit ?? 1,
        playdatesCreatedPerMonth: quotaData.usage?.[QUOTA_FEATURES.PLAYDATES_CREATED]?.limit ?? 3,
      },
      usage: {
        discoveryViewsToday: quotaData.usage?.[QUOTA_FEATURES.DISCOVERY_SWIPES]?.used ?? 0,
        playdatesCreatedThisMonth: quotaData.usage?.[QUOTA_FEATURES.PLAYDATES_CREATED]?.used ?? 0,
      },
    };
  }
}

export default new SubscriptionService();
