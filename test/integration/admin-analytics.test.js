import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Payment from '../../src/modules/subscription/payment.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';

const password = 'AdminAnalytics123!';

// Old dates no other suite writes to (suites share one database)
const createParentUser = (email, createdAt) =>
  User.create({ email, passwordHash: 'x', role: 'parent', isActive: true, createdAt });

const getAnalytics = (token, query) =>
  request(adminApp).get('/api/v1/admin/analytics').query(query).set('Authorization', `Bearer ${token}`);

describe('GET /api/v1/admin/analytics', () => {
  let token = '';

  beforeAll(async () => {
    const email = `analytics-admin-${Date.now()}@buddylink.com`;
    await User.create({ email, passwordHash: await bcrypt.hash(password, 10), role: 'admin', isActive: true });
    const login = await request(adminApp).post('/api/v1/admin/auth/login').send({ email, password });
    token = login.body.data.tokens.accessToken;
  });

  describe('day bounds in APP_TIMEZONE (UTC+7)', () => {
    beforeAll(async () => {
      const stamp = Date.now();
      // 2019-03-02 00:00 in Ho Chi Minh is 2019-03-01 17:00 UTC
      await createParentUser(`tz-before-${stamp}@example.com`, new Date('2019-03-01T16:59:59.000Z'));
      await createParentUser(`tz-first-${stamp}@example.com`, new Date('2019-03-01T17:00:00.000Z'));
      await createParentUser(`tz-last-${stamp}@example.com`, new Date('2019-03-02T16:59:59.000Z'));
      await createParentUser(`tz-after-${stamp}@example.com`, new Date('2019-03-02T17:00:00.000Z'));
    });

    it('counts exactly the instants of the selected local day', async () => {
      const res = await getAnalytics(token, { fromDate: '2019-03-02', toDate: '2019-03-02' });

      expect(res.status).toBe(200);
      expect(res.body.data.overview.newParents.value).toBe(2);
      expect(res.body.data.userGrowth.timeline).toEqual([
        { period: '2019-03-02', label: '02/03', count: 2 },
      ]);
    });

    it('compares with a previous period of the same length', async () => {
      const res = await getAnalytics(token, { fromDate: '2019-03-02', toDate: '2019-03-02' });

      // 2019-03-01 local holds the parent created one second before the selected day
      expect(res.body.data.overview.newParents).toEqual({ value: 2, previousValue: 1, changePercent: 100 });
    });

    it('returns null changePercent when the previous period is 0', async () => {
      const res = await getAnalytics(token, { fromDate: '2019-03-01', toDate: '2019-03-01' });

      expect(res.body.data.overview.newParents).toEqual({ value: 1, previousValue: 0, changePercent: null });
    });
  });

  describe('periods', () => {
    it('keeps periods without data, with value 0', async () => {
      const res = await getAnalytics(token, { fromDate: '2018-01-01', toDate: '2018-01-03' });

      expect(res.body.data.revenue.timeline).toEqual([
        { period: '2018-01-01', label: '01/01', revenue: 0, transactionCount: 0 },
        { period: '2018-01-02', label: '02/01', revenue: 0, transactionCount: 0 },
        { period: '2018-01-03', label: '03/01', revenue: 0, transactionCount: 0 },
      ]);
    });

    it('includes the week of the last day of the range', async () => {
      const res = await getAnalytics(token, { fromDate: '2026-08-02', toDate: '2026-10-30', groupBy: 'week' });

      const periods = res.body.data.playdates.timeline.map((row) => row.period);
      expect(periods[0]).toBe('2026-W31');
      expect(periods[periods.length - 1]).toBe('2026-W44');
      expect(res.body.data.playdates.timeline[0].label).toBe('Tuần 31/2026');
    });

    it('puts a day of the first ISO week in the period MongoDB groups it in', async () => {
      await createParentUser(`iso-week-${Date.now()}@example.com`, new Date('2024-12-30T05:00:00.000Z'));

      const res = await getAnalytics(token, { fromDate: '2024-12-30', toDate: '2025-01-02', groupBy: 'week' });

      expect(res.body.data.userGrowth.timeline).toEqual([
        expect.objectContaining({ period: '2025-W01', count: 1 }),
      ]);
    });

    it('groups by calendar month', async () => {
      const res = await getAnalytics(token, { fromDate: '2018-01-15', toDate: '2018-03-02', groupBy: 'month' });

      expect(res.body.data.aiUsage.timeline.map((row) => row.label)).toEqual(['T1/2018', 'T2/2018', 'T3/2018']);
    });

    it('defaults to the last 30 days, today included, grouped by day', async () => {
      const res = await getAnalytics(token, {});

      expect(res.status).toBe(200);
      expect(res.body.data.filter.groupBy).toBe('day');
      expect(res.body.data.userGrowth.timeline).toHaveLength(30);
    });
  });

  describe('validation', () => {
    it('rejects a range over 12 months, with both dates or with fromDate alone', async () => {
      const both = await getAnalytics(token, { fromDate: '2020-01-01', toDate: '2021-06-01' });
      const alone = await getAnalytics(token, { fromDate: '2000-01-01' });

      expect(both.status).toBe(400);
      expect(alone.status).toBe(400);
    });

    it('rejects fromDate after toDate', async () => {
      const res = await getAnalytics(token, { fromDate: '2020-02-01', toDate: '2020-01-01' });

      expect(res.status).toBe(400);
    });

    it('rejects a parent token', async () => {
      const email = `analytics-parent-${Date.now()}@example.com`;
      const reg = await request(app).post('/api/v1/auth/register').send({ fullName: 'Parent', email, password });

      const res = await getAnalytics(reg.body.data.tokens.accessToken, {});

      expect(res.status).toBe(401);
    });
  });

  describe('conversion funnel', () => {
    it('counts hosts and accepted participants, not pending, declined or cancelled ones', async () => {
      const createdAt = new Date('2015-01-01T05:00:00.000Z');
      const parentId = () => new mongoose.Types.ObjectId();
      const earlier = await getAnalytics(token, { fromDate: '2014-12-30', toDate: '2014-12-31' });
      const before = earlier.body.data.conversion.funnel.find(({ step }) => step === 'firstPlaydate').count;

      await Playdate.collection.insertMany([
        {
          hostParentId: parentId(),
          status: 'upcoming',
          createdAt,
          participants: [
            { parentId: parentId(), status: 'accepted' },
            { parentId: parentId(), status: 'pending' },
            { parentId: parentId(), status: 'declined' },
          ],
        },
        {
          hostParentId: parentId(),
          status: 'cancelled',
          createdAt,
          participants: [{ parentId: parentId(), status: 'accepted' }],
        },
      ]);

      const res = await getAnalytics(token, { fromDate: '2015-01-01', toDate: '2015-01-02' });

      expect(res.body.data.conversion.funnel.find(({ step }) => step === 'firstPlaydate').count).toBe(before + 2);
    });
  });

  describe('details', () => {
    let parent = null;
    const stamp = Date.now();

    const createPayment = (orderCode, { startDate, endDate, paidAt }) =>
      Payment.create({
        parentId: parent._id,
        orderCode,
        amount: 100000,
        status: 'success',
        paymentMethod: 'payos',
        planSnapshot: { planCode: 'premium_monthly', name: 'Premium', price: 100000, currency: 'VND', durationMonths: 1 },
        grantResult: { effectiveStartDate: startDate, effectiveEndDate: endDate, monthsGranted: 1 },
        paidAt,
        expiresAt: paidAt,
      });

    beforeAll(async () => {
      const user = await createParentUser(`details-${stamp}@example.com`, new Date('2016-01-01T00:00:00.000Z'));
      parent = await Parent.create({ userId: user._id, fullName: 'Details Parent', location: { coordinates: [108.2022, 16.0544] } });
      // A first cycle, renewed once (same start date) and ending in the range, then one started later
      await createPayment(stamp, {
        startDate: new Date('2016-03-01T05:00:00.000Z'),
        endDate: new Date('2016-04-01T05:00:00.000Z'),
        paidAt: new Date('2016-03-01T05:00:00.000Z'),
      });
      await createPayment(stamp + 1, {
        startDate: new Date('2016-03-01T05:00:00.000Z'),
        endDate: new Date('2016-05-01T05:00:00.000Z'),
        paidAt: new Date('2016-03-20T05:00:00.000Z'),
      });
      await createPayment(stamp + 2, {
        startDate: new Date('2016-06-10T05:00:00.000Z'),
        endDate: new Date('2016-07-10T05:00:00.000Z'),
        paidAt: new Date('2016-06-10T05:00:00.000Z'),
      });
    });

    it('sums revenue per period through the revenue metrics', async () => {
      const res = await getAnalytics(token, { fromDate: '2016-03-01', toDate: '2016-07-31', groupBy: 'month' });

      expect(res.body.data.overview.totalRevenue.value).toBe(300000);
      expect(res.body.data.overview.successfulTransactions).toEqual({ value: 3, previousValue: 0, changePercent: null });
      expect(res.body.data.overview.activeUsers).toBeUndefined();
      expect(res.body.data.revenue.timeline).toEqual([
        { period: '2016-03', label: 'T3/2016', revenue: 200000, transactionCount: 2 },
        { period: '2016-04', label: 'T4/2016', revenue: 0, transactionCount: 0 },
        { period: '2016-05', label: 'T5/2016', revenue: 0, transactionCount: 0 },
        { period: '2016-06', label: 'T6/2016', revenue: 100000, transactionCount: 1 },
        { period: '2016-07', label: 'T7/2016', revenue: 0, transactionCount: 0 },
      ]);
    });

    it('reads active Premium as of the end of the range', async () => {
      const res = await getAnalytics(token, { fromDate: '2016-03-15', toDate: '2016-03-15' });

      expect(res.body.data.overview.activePremiumSubscriptions.value).toBeGreaterThanOrEqual(1);
    });

    it('counts accepted connections of the range only', async () => {
      const other = await Parent.create({
        userId: (await createParentUser(`details-other-${stamp}@example.com`, new Date('2016-01-01T00:00:00.000Z')))._id,
        fullName: 'Other Parent',
        location: { coordinates: [108.2022, 16.0544] },
      });
      await Connection.create({
        parents: [parent._id, other._id],
        requesterId: parent._id,
        recipientId: other._id,
        status: 'accepted',
        connectedAt: new Date('2016-08-05T05:00:00.000Z'),
        createdAt: new Date('2016-08-04T05:00:00.000Z'),
      });

      const inRange = await getAnalytics(token, { fromDate: '2016-08-01', toDate: '2016-08-31' });
      const after = await getAnalytics(token, { fromDate: '2016-09-01', toDate: '2016-09-30' });

      expect(inRange.body.data.overview.acceptedConnections.value).toBe(1);
      expect(inRange.body.data.connections).toEqual(
        expect.objectContaining({ sent: 1, accepted: 1, acceptanceRate: 100 })
      );
      expect(after.body.data.overview.acceptedConnections).toEqual({ value: 0, previousValue: 1, changePercent: -100 });
    });

    it('returns the 4 age groups with their counts', async () => {
      const res = await getAnalytics(token, { fromDate: '2016-03-01', toDate: '2016-03-02' });

      expect(res.body.data.children.byAgeGroup.map((row) => row.group)).toEqual([
        '0-2 tuổi',
        '3-5 tuổi',
        '6-10 tuổi',
        '11+ tuổi',
      ]);
    });
  });
});
