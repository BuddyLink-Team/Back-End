import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';

describe('Admin portal separation (/api/v1/admin on the admin app)', () => {
  const password = 'AdminPortal123!';
  const adminEmail = `portal-admin-${Date.now()}@buddylink.com`;
  const parentEmail = `portal-parent-${Date.now()}@example.com`;
  let parentToken = '';
  let adminTokens = null;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ email: adminEmail, passwordHash, role: 'admin', isActive: true });

    const parentReg = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Portal Parent',
      email: parentEmail,
      password,
    });
    parentToken = parentReg.body.data.tokens.accessToken;

    const adminLogin = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminEmail, password });
    adminTokens = adminLogin.body.data.tokens;
  });

  it('admin signs in on the admin app and reads their session', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/auth/me')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('admin');
  });

  it('admin routes do not exist on the parent app', async () => {
    const oldLogin = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: adminEmail, password });
    expect(oldLogin.status).toBe(404);

    const adminPath = await request(app).post('/api/v1/admin/auth/login').send({ email: adminEmail, password });
    expect(adminPath.status).toBe(404);
  });

  it('admins cannot sign in on the parent app', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ADMIN_PORTAL_REQUIRED');
  });

  it('admin portal tokens are rejected by the parent app', async () => {
    const access = await request(app)
      .get('/api/v1/user/me')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);
    expect(access.status).toBe(401);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh-token')
      .send({ refreshToken: adminTokens.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('parent app tokens are rejected by the admin app', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/auth/me')
      .set('Authorization', `Bearer ${parentToken}`);

    expect(res.status).toBe(401);
  });

  it('admin refresh keeps the session on the admin portal', async () => {
    const refresh = await request(adminApp)
      .post('/api/v1/admin/auth/refresh-token')
      .send({ refreshToken: adminTokens.refreshToken });
    expect(refresh.status).toBe(200);

    const me = await request(adminApp)
      .get('/api/v1/admin/auth/me')
      .set('Authorization', `Bearer ${refresh.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });
});

describe('Admin Subscription Plans & Revenue Management (/api/v1/admin)', () => {
  const password = 'AdminPortal123!';
  const adminEmail = `sub-admin-${Date.now()}@buddylink.com`;
  let adminTokens = null;
  let testParent = null;
  let freePlan = null;
  let monthlyPlan = null;
  let createdPayment = null;

  beforeAll(async () => {
    // Seed default plans
    const { default: subscriptionPlanRepository } = await import('../../src/modules/subscription/subscription-plan.repository.js');
    await subscriptionPlanRepository.seedDefaultPlans();

    // Create admin user
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ email: adminEmail, passwordHash, role: 'admin', isActive: true });

    const adminLogin = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminEmail, password });
    adminTokens = adminLogin.body.data.tokens;

    // Create a test parent user and parent profile
    const parentEmail = `parent-sub-${Date.now()}@example.com`;
    const userParent = await User.create({ email: parentEmail, passwordHash, role: 'parent', isActive: true });
    const { default: Parent } = await import('../../src/modules/parent/parent.model.js');
    testParent = await Parent.create({
      userId: userParent._id,
      fullName: 'Test Parent Subscription',
      location: { coordinates: [108.2022, 16.0544] },
    });

    // Create a subscription for this parent
    const { default: Subscription } = await import('../../src/modules/subscription/subscription.model.js');
    await Subscription.create({
      parentId: testParent._id,
      planCode: 'premium_monthly',
      status: 'active',
      startDate: new Date('2026-10-01T00:00:00Z'),
      endDate: new Date('2026-11-01T00:00:00Z'),
      purchasedMonths: 1,
    });

    // Create test payments
    const { default: Payment } = await import('../../src/modules/subscription/payment.model.js');
    createdPayment = await Payment.create({
      parentId: testParent._id,
      orderCode: 99887766,
      amount: 99000,
      status: 'success',
      paymentMethod: 'payos',
      planSnapshot: {
        planCode: 'premium_monthly',
        name: 'Gói Cao Cấp 1 Tháng',
        price: 99000,
        currency: 'VND',
        durationMonths: 1,
      },
      grantResult: {
        effectiveStartDate: new Date('2026-10-01T00:00:00Z'),
        effectiveEndDate: new Date('2026-11-01T00:00:00Z'),
        monthsGranted: 1,
      },
      checkoutUrl: 'https://payos.vn/checkout-secret-url',
      qrCode: 'qr-code-secret-payload',
      paidAt: new Date('2026-10-01T10:00:00Z'),
      expiresAt: new Date('2026-10-01T10:15:00Z'),
      createdAt: new Date('2026-10-01T09:50:00Z'),
    });
  });

  it('GET /api/v1/admin/plans returns all 3 plans with quotas', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const plans = res.body.data.plans;
    expect(plans.length).toBeGreaterThanOrEqual(3);

    freePlan = plans.find((p) => p.planCode === 'free');
    monthlyPlan = plans.find((p) => p.planCode === 'premium_monthly');
    expect(freePlan).toBeDefined();
    expect(monthlyPlan).toBeDefined();
    expect(freePlan.price).toBe(0);
  });

  it('PATCH /api/v1/admin/plans/:id rejects changing free plan price or deactivating', async () => {
    const resPrice = await request(adminApp)
      .patch(`/api/v1/admin/plans/${freePlan.id}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ price: 50000 });

    expect(resPrice.status).toBe(400);
    expect(resPrice.body.error.code).toBe('FREE_PLAN_IMMUTABLE');

    const resActive = await request(adminApp)
      .patch(`/api/v1/admin/plans/${freePlan.id}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ isActive: false });

    expect(resActive.status).toBe(400);
    expect(resActive.body.error.code).toBe('FREE_PLAN_IMMUTABLE');
  });

  it('PATCH /api/v1/admin/plans/:id updates premium plan and preserves read-only fields', async () => {
    const res = await request(adminApp)
      .patch(`/api/v1/admin/plans/${monthlyPlan.id}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        name: 'Gói Tháng Cập Nhật',
        price: 89000,
        planCode: 'hacked_code',
        durationMonths: 99,
        billingCycle: 'yearly',
        currency: 'USD',
        features: {
          childProfilesLimit: 5,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.plan.name).toBe('Gói Tháng Cập Nhật');
    expect(res.body.data.plan.price).toBe(89000);
    // Read-only fields must NOT have been changed
    expect(res.body.data.plan.planCode).toBe('premium_monthly');
    expect(res.body.data.plan.durationMonths).toBe(1);
    expect(res.body.data.plan.billingCycle).toBe('monthly');
    expect(res.body.data.plan.currency).toBe('VND');
    expect(res.body.data.plan.features.childProfilesLimit).toBe(5);
  });

  it('GET /api/v1/admin/subscriptions returns paginated subscriptions with parent details', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/subscriptions?planCode=premium_monthly&status=active')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toBeDefined();
    expect(res.body.data.pagination).toBeDefined();

    const item = res.body.data.items.find((s) => s.parent.fullName === 'Test Parent Subscription');
    expect(item).toBeDefined();
    expect(item.parent.email).toBeDefined();
    expect(item.planCode).toBe('premium_monthly');
  });

  it('GET /api/v1/admin/payments returns paginated payment list with filters', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/payments?status=success&search=99887766')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);

    const payment = res.body.data.items[0];
    expect(payment.orderCode).toBe(99887766);
    expect(payment.parent.fullName).toBe('Test Parent Subscription');
    expect(payment.effectivePeriod).toBeDefined();
  });

  it('GET /api/v1/admin/payments/:id returns detail without checkoutUrl and qrCode', async () => {
    const res = await request(adminApp)
      .get(`/api/v1/admin/payments/${createdPayment._id}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const detail = res.body.data;
    expect(detail.orderCode).toBe(99887766);
    expect(detail.checkoutUrl).toBeUndefined();
    expect(detail.qrCode).toBeUndefined();
    expect(detail.grantResult).toBeDefined();
  });

  it('GET /api/v1/admin/revenue/summary calculates revenue, conversion, and churn rate', async () => {
    const fromDate = '2026-10-01T00:00:00Z';
    const toDate = '2026-10-31T23:59:59Z';
    const res = await request(adminApp)
      .get(`/api/v1/admin/revenue/summary?fromDate=${fromDate}&toDate=${toDate}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { overview, monthlyRevenue } = res.body.data;

    expect(overview.totalRevenue).toBeGreaterThanOrEqual(99000);
    expect(overview.successfulTransactions).toBeGreaterThanOrEqual(1);
    expect(overview.payingParentsCount).toBeGreaterThanOrEqual(1);
    expect(overview.activePremiumSubscribers).toBeGreaterThanOrEqual(1);
    expect(typeof overview.conversionRate).toBe('number');
    expect(typeof overview.churnRate).toBe('number');
    expect(Array.isArray(monthlyRevenue)).toBe(true);
  });
});

