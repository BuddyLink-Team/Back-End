import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../src/app.js';
import env from '../../src/config/env.js';
import subscriptionService, {
  calculateCalendarEndDate,
} from '../../src/modules/subscription/subscription.service.js';

function sortObjDataByKey(object) {
  return Object.keys(object)
    .sort()
    .reduce((obj, key) => {
      obj[key] = object[key];
      return obj;
    }, {});
}

function convertObjToQueryStr(object) {
  return Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .map((key) => {
      let value = object[key];
      if (value && Array.isArray(value)) {
        value = JSON.stringify(value.map((val) => sortObjDataByKey(val)));
      }
      if ([null, undefined, 'undefined', 'null'].includes(value)) {
        value = '';
      }
      return `${key}=${value}`;
    })
    .join('&');
}

function signWebhookData(data) {
  const sorted = sortObjDataByKey(data);
  const queryStr = convertObjToQueryStr(sorted);
  return crypto
    .createHmac('sha256', env.PAYOS.CHECKSUM_KEY)
    .update(queryStr)
    .digest('hex');
}

function createSignedWebhookPayload(data, code = '00', desc = 'success') {
  const signature = signWebhookData(data);
  return {
    code,
    desc,
    success: code === '00',
    data,
    signature,
  };
}


describe('Subscription & Payment Integration Flow', () => {
  let parentToken = '';
  let parentId = '';
  const testEmail = `sub-test-${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  beforeAll(async () => {
    // Seed plans
    await subscriptionService.seedSubscriptionPlans();

    // Register parent
    const res = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Subscription Test Parent',
      email: testEmail,
      password: testPassword,
    });
    parentToken = res.body.data.tokens.accessToken;

    // Get parentId
    const profileRes = await request(app)
      .get('/api/v1/parent/me')
      .set('Authorization', `Bearer ${parentToken}`);
    parentId = profileRes.body.data.id || profileRes.body.data._id;
  });

  describe('Calendar Month Date Calculation', () => {
    it('should correctly calculate exact calendar month addition preserving anchor day', () => {
      // Jan 31 + 1 month -> Feb 28 (or 29)
      const anchorJan31 = new Date('2026-01-31T15:00:00.000Z');
      const endFeb = calculateCalendarEndDate(anchorJan31, 1);
      expect(endFeb.toISOString()).toContain('2026-02-28');

      // Jan 31 + 2 months -> March 31
      const endMar = calculateCalendarEndDate(anchorJan31, 2);
      expect(endMar.toISOString()).toContain('2026-03-31');

      // Jan 31 + 3 months -> April 30
      const endApr = calculateCalendarEndDate(anchorJan31, 3);
      expect(endApr.toISOString()).toContain('2026-04-30');
    });
  });

  describe('GET /api/v1/subscriptions/plans', () => {
    it('should return available active subscription plans', async () => {
      const res = await request(app).get('/api/v1/subscriptions/plans');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      const freePlan = res.body.data.find((p) => p.planCode === 'free');
      expect(freePlan).toBeDefined();
      expect(freePlan.price).toBe(0);
      expect(freePlan.features.childProfilesLimit).toBe(1);

      const premiumMonthly = res.body.data.find((p) => p.planCode === 'premium_monthly');
      expect(premiumMonthly).toBeDefined();
      expect(premiumMonthly.price).toBe(99000);
    });
  });

  describe('GET /api/v1/subscriptions/my', () => {
    it('should retrieve current parent subscription and quota summary', async () => {
      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.isPremium).toBe(false);
      expect(res.body.data.effectivePlanCode).toBe('free');
      expect(res.body.data.usage.child_profiles.limit).toBe(1);
      expect(res.body.data.usage.child_profiles.used).toBe(0);
    });

    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/subscriptions/my');
      expect(res.status).toBe(401);
    });
  });

  describe('Child Profile Quota Enforcement (Free Plan)', () => {
    it('should allow creating the 1st child on Free plan', async () => {
      const childData = {
        displayName: 'First Child',
        dateOfBirth: '2020-05-15',
        gender: 'boy',
        interests: ['Lego & Lắp ráp'],
      };

      const res = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${parentToken}`)
        .send(childData);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayName).toBe('First Child');
    });

    it('should block creating the 2nd child with 403 CHILD_QUOTA_EXCEEDED on Free plan', async () => {
      const childData = {
        displayName: 'Second Child',
        dateOfBirth: '2022-08-20',
        gender: 'girl',
        interests: ['Vẽ & Hội họa'],
      };

      const res = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${parentToken}`)
        .send(childData);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CHILD_QUOTA_EXCEEDED');
      expect(res.body.error.details.limit).toBe(1);
    });
  });

  describe('PayOS Checkout & Webhook Flow', () => {
    let checkoutOrderCode;
    let checkoutPaymentLinkId;

    it('should create a checkout session and save Payment before calling PayOS', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', `idem-${Date.now()}`)
        .send({
          planCode: 'premium_monthly',
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderCode).toBeDefined();
      expect(res.body.data.amount).toBe(99000);
      expect(res.body.data.planSnapshot.planCode).toBe('premium_monthly');

      checkoutOrderCode = res.body.data.orderCode;
      checkoutPaymentLinkId = res.body.data.paymentLinkId;
    });

    it('should return existing checkout when called with same Idempotency-Key', async () => {
      const testKey = `idem-repeat-${Date.now()}`;
      const firstRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', testKey)
        .send({
          planCode: 'premium_monthly',
        });

      const secondRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', testKey)
        .send({
          planCode: 'premium_monthly',
        });

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.data.orderCode).toBe(firstRes.body.data.orderCode);
    });

    it('should fulfill payment and activate Premium via webhook', async () => {
      const webhookData = {
        orderCode: checkoutOrderCode,
        amount: 99000,
        description: `BL${checkoutOrderCode}`,
        accountNumber: '1028723948',
        reference: 'TRANS_123456',
        transactionDateTime: new Date().toISOString(),
        currency: 'VND',
        paymentLinkId: checkoutPaymentLinkId || `mock_pl_${checkoutOrderCode}`,
        code: '00',
        desc: 'success',
      };

      const webhookPayload = createSignedWebhookPayload(webhookData);

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify active subscription now
      const subRes = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(subRes.body.data.isPremium).toBe(true);
      expect(subRes.body.data.effectivePlanCode).toBe('premium_monthly');
      expect(subRes.body.data.usage.child_profiles.limit).toBe(-1);
    });

    it('should be idempotent and not add double months on duplicate webhook', async () => {
      const webhookData = {
        orderCode: checkoutOrderCode,
        amount: 99000,
        code: '00',
        paymentLinkId: checkoutPaymentLinkId || `mock_pl_${checkoutOrderCode}`,
      };

      const webhookPayload = createSignedWebhookPayload(webhookData);

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should verify payment status via GET /payments/verify/:orderCode', async () => {
      const res = await request(app)
        .get(`/api/v1/subscriptions/payments/verify/${checkoutOrderCode}`)
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('success');
      expect(res.body.data.orderCode).toBe(checkoutOrderCode);
    });

    it('should allow creating the 2nd child now that user has Premium', async () => {
      const childData = {
        displayName: 'Second Child (Unlocked)',
        dateOfBirth: '2022-08-20',
        gender: 'girl',
        interests: ['Vẽ & Hội họa'],
      };

      const res = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${parentToken}`)
        .send(childData);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayName).toBe('Second Child (Unlocked)');
    });

    it('should list payment history with pagination', async () => {
      const res = await request(app)
        .get('/api/v1/subscriptions/payments/history?page=1&limit=10')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.pagination.page).toBe(1);
    });
  });

  describe('Error Handling & Edge Cases (Mục 8)', () => {
    it('should reject checkout without Idempotency-Key header with 400', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .send({
          planCode: 'premium_monthly',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject checkout with Free plan or invalid plan with 400', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', `idem-free-${Date.now()}`)
        .send({
          planCode: 'free',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 409 IDEMPOTENCY_CONFLICT when reuse key with different plan', async () => {
      const conflictKey = `idem-conflict-${Date.now()}`;

      // First checkout with premium_monthly
      await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', conflictKey)
        .send({
          planCode: 'premium_monthly',
        });

      // Second checkout with same key but premium_yearly
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', conflictKey)
        .send({
          planCode: 'premium_yearly',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('should reject webhook with invalid signature with 400 INVALID_WEBHOOK_SIGNATURE', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          code: '00',
          desc: 'success',
          data: {
            orderCode: 999999,
            amount: 99000,
          },
          signature: 'invalid_forged_signature_hex',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('should reject webhook without signature with 400 INVALID_WEBHOOK_SIGNATURE', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({
          code: '00',
          desc: 'success',
          data: {
            orderCode: 999999,
            amount: 99000,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('should reject webhook with amount mismatch with 400 AMOUNT_MISMATCH', async () => {
      // Create a checkout
      const checkRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', `idem-amount-${Date.now()}`)
        .send({
          planCode: 'premium_monthly',
        });

      const orderCode = checkRes.body.data.orderCode;

      // Send signed webhook with wrong amount (e.g. 50000 instead of 99000)
      const webhookPayload = createSignedWebhookPayload({
        orderCode,
        amount: 50000,
        code: '00',
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AMOUNT_MISMATCH');
    });

    it('should reject webhook with paymentLinkId mismatch with 400 PAYMENT_LINK_MISMATCH', async () => {
      // Create a checkout
      const checkRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', `idem-plink-${Date.now()}`)
        .send({
          planCode: 'premium_monthly',
        });

      const orderCode = checkRes.body.data.orderCode;

      // Send signed webhook with wrong paymentLinkId
      const webhookPayload = createSignedWebhookPayload({
        orderCode,
        amount: 99000,
        paymentLinkId: 'different_unmatched_pl_id',
        code: '00',
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PAYMENT_LINK_MISMATCH');
    });

    it('should acknowledge sample test webhook ping with valid signature', async () => {
      const webhookPayload = createSignedWebhookPayload({
        orderCode: 123,
        isTest: true,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should enforce swipe quota (5 free swipes allowed, 6th rejected)', async () => {
      // Create a new free parent
      const email = `swipe-test-${Date.now()}@example.com`;
      const regRes = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Swipe Test Parent',
        email,
        password: testPassword,
      });
      const token = regRes.body.data.tokens.accessToken;
      const freeParentId = regRes.body.data.parent.id;

      // Consume 5 swipes
      for (let i = 0; i < 5; i++) {
        const result = await subscriptionService.checkAndConsumeQuota(
          freeParentId,
          'discovery_swipes',
          true
        );
        expect(result.allowed).toBe(true);
      }

      // 6th swipe should throw 403 QUOTA_EXCEEDED
      await expect(
        subscriptionService.checkAndConsumeQuota(freeParentId, 'discovery_swipes', true)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'QUOTA_EXCEEDED',
      });
    });

    it('should enforce playdate created quota (3 free playdates allowed, 4th rejected)', async () => {
      // Create a new free parent
      const email = `playdate-test-${Date.now()}@example.com`;
      const regRes = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Playdate Test Parent',
        email,
        password: testPassword,
      });
      const freeParentId = regRes.body.data.parent.id;

      // Consume 3 playdate creates
      for (let i = 0; i < 3; i++) {
        const result = await subscriptionService.checkAndConsumeQuota(
          freeParentId,
          'playdates_created',
          true
        );
        expect(result.allowed).toBe(true);
      }

      // 4th playdate create should throw 403 QUOTA_EXCEEDED
      await expect(
        subscriptionService.checkAndConsumeQuota(freeParentId, 'playdates_created', true)
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'QUOTA_EXCEEDED',
      });
    });

    it('should correctly sum durations when parent buys multiple orders sequentially', async () => {
      // Create second payment of 12 months for same parent
      const secondCheckRes = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Authorization', `Bearer ${parentToken}`)
        .set('Idempotency-Key', `idem-yearly-${Date.now()}`)
        .send({
          planCode: 'premium_yearly',
        });

      const yearlyOrderCode = secondCheckRes.body.data.orderCode;
      const yearlyPaymentLinkId = secondCheckRes.body.data.paymentLinkId;

      // Fulfill yearly order with signed webhook
      const webhookPayload = createSignedWebhookPayload({
        orderCode: yearlyOrderCode,
        amount: 990000,
        paymentLinkId: yearlyPaymentLinkId,
        code: '00',
      });

      const fulfillRes = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send(webhookPayload);

      expect(fulfillRes.status).toBe(200);

      // Verify parent now has 1 + 12 = 13 purchasedMonths
      const mySub = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(mySub.body.data.isPremium).toBe(true);
      expect(mySub.body.data.subscription.purchasedMonths).toBe(13);
    });
  });
});


