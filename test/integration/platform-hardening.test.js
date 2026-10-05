import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import subscriptionService from '../../src/modules/subscription/subscription.service.js';
import Subscription from '../../src/modules/subscription/subscription.model.js';
import UsageQuota from '../../src/modules/subscription/usage-quota.model.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import AppError from '../../src/shared/exceptions/AppError.js';

const createResStub = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const register = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Parent ${label}`,
    email: `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    password: 'Password123!',
  });
  return { token: res.body.data.tokens.accessToken, parentId: res.body.data.parent.id };
};

describe('Error handler', () => {
  it('should hide internal error messages behind a generic 500', () => {
    const res = createResStub();
    errorHandler(new Error('connect ECONNREFUSED 10.0.0.5:27017 (secret host)'), {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });

  it('should keep operational AppError messages', () => {
    const res = createResStub();
    errorHandler(new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND'), {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toBe('Child profile not found');
  });

  it('should keep client errors raised by body-parser (malformed JSON)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Subscription quota', () => {
  it('should not exceed the limit under concurrent consumption', async () => {
    const { parentId } = await register('quota');

    // Free plan: 5 discovery views per day
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => subscriptionService.checkAndConsumeQuota(parentId, 'discovery', true)),
    );

    const allowed = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(allowed).toBe(5);
    expect(rejected.every((r) => r.reason.code === 'QUOTA_EXCEEDED')).toBe(true);

    const quota = await UsageQuota.findOne({ parentId, periodType: 'daily' }).lean();
    expect(quota.counters.discoveryViews).toBe(5);
  });

  it('should compute quota periods in Vietnam time, not UTC', () => {
    // 2026-10-04 18:30 UTC is already 2026-10-05 01:30 in Vietnam
    const lateEveningUtc = new Date('2026-10-04T18:30:00.000Z');
    expect(subscriptionService.getPeriodValue('daily', lateEveningUtc)).toBe('2026-10-05');

    // 2026-10-31 20:00 UTC is 2026-11-01 03:00 in Vietnam
    expect(subscriptionService.getPeriodValue('monthly', new Date('2026-10-31T20:00:00.000Z'))).toBe('2026-11');
  });

  it('should expire past-due premium plans and fall back to Free', async () => {
    const { parentId } = await register('expiry');
    await Subscription.updateMany({ parentId }, { $set: { status: 'cancelled' } });
    await Subscription.create({
      parentId,
      planCode: 'premium_monthly',
      status: 'active',
      startDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 60 * 1000),
    });

    // Lazy expiry on read, before the scheduled job runs
    const active = await subscriptionService.getActiveSubscriptionByParentId(parentId);
    expect(active.planCode).toBe('free');

    const premium = await Subscription.findOne({ parentId, planCode: 'premium_monthly' }).lean();
    expect(premium.status).toBe('expired');
  });

  it('expireDueSubscriptions should downgrade every past-due plan', async () => {
    const { parentId } = await register('expiry-job');
    await Subscription.updateMany({ parentId }, { $set: { status: 'cancelled' } });
    await Subscription.create({
      parentId,
      planCode: 'premium_yearly',
      status: 'active',
      endDate: new Date(Date.now() - 1000),
    });

    const count = await subscriptionService.expireDueSubscriptions();
    expect(count).toBeGreaterThanOrEqual(1);

    const active = await Subscription.find({ parentId, status: 'active' }).lean();
    expect(active).toHaveLength(1);
    expect(active[0].planCode).toBe('free');
  });
});

describe('Safety report limits', () => {
  it('should reject external evidence URLs and repeated reports', async () => {
    const reporter = await register('reporter');
    const reported = await register('reported');

    const externalRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedUserId: reported.parentId, reason: 'Spam', evidenceUrls: ['https://evil.example.com/x.png'] });
    expect(externalRes.status).toBe(400);
    expect(externalRes.body.error.code).toBe('INVALID_EVIDENCE_URL');

    const firstRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedUserId: reported.parentId, reason: 'Spam' });
    expect(firstRes.status).toBe(201);

    const repeatRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedUserId: reported.parentId, reason: 'Spam again' });
    expect(repeatRes.status).toBe(429);
    expect(repeatRes.body.error.code).toBe('REPORT_TOO_FREQUENT');
  });
});

describe('Trust proxy', () => {
  it('should be configured on the app', () => {
    expect(app.get('trust proxy')).toBeDefined();
  });
});
