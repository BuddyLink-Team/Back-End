import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Subscription from '../../src/modules/subscription/subscription.model.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

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

describe('Admin portal parent and child management (/api/v1/admin)', () => {
  const password = 'AdminPortal123!';
  let adminToken = '';
  let adminUserId = '';
  let otherAdminUserId = '';
  let parentUser = null;
  let testChild = null;

  beforeAll(async () => {
    // 1. Create primary admin
    const adminEmail = `admin-mgmt-${Date.now()}@buddylink.com`;
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await User.create({ email: adminEmail, passwordHash, role: 'admin', isActive: true });
    adminUserId = admin._id.toString();

    // 2. Create second admin
    const otherAdmin = await User.create({
      email: `other-admin-${Date.now()}@buddylink.com`,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
    otherAdminUserId = otherAdmin._id.toString();

    const adminLogin = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 3. Register a test parent via parent app
    const parentEmail = `parent-mgmt-${Date.now()}@example.com`;
    const parentReg = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Hoang Vo Parent',
      email: parentEmail,
      password,
    });
    const parentAccessToken = parentReg.body.data.tokens.accessToken;
    parentUser = await User.findOne({ email: parentEmail });

    // Set phone and city for testing
    parentUser.phone = '+84901234567';
    await parentUser.save();

    // 4. Add child for this parent
    const childRes = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${parentAccessToken}`)
      .send({
        displayName: 'Bé Bi',
        dateOfBirth: '2020-05-15',
        gender: 'boy',
        interests: ['Lego', 'Vẽ tranh'],
        favoriteActivities: ['Đạp xe'],
        personality: ['Hòa đồng'],
      });
    testChild = childRes.body.data;
  });

  describe('GET /api/v1/admin/users', () => {
    it('returns paginated list of parent accounts with parent profile details', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/users?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();

      const found = res.body.data.items.find((u) => u.id === parentUser._id.toString());
      expect(found).toBeDefined();
      expect(found.fullName).toBe('Hoang Vo Parent');
      expect(found.email).toBe(parentUser.email);
      expect(found.childrenCount).toBeGreaterThanOrEqual(1);
      expect(found.isProfileHidden).toBe(false);
      expect(found).not.toHaveProperty('verification');
    });

    it('finds a parent by email as well as by name', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/users?search=${encodeURIComponent(parentUser.email)}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.map((u) => u.id)).toEqual([parentUser._id.toString()]);
    });

    it('rejects a search longer than 100 characters', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/users?search=${'a'.repeat(101)}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it('filters users by search query matching name, email, or phone', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/users?search=Hoang')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((u) => u.fullName.includes('Hoang'))).toBe(true);
    });

    it('filters users by isActive status', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/users?isActive=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((u) => u.isActive === true)).toBe(true);
    });
    it('shows a paid plan past its end date as Free', async () => {
      const parent = await Parent.findOne({ userId: parentUser._id });
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await Subscription.findOneAndUpdate(
        { parentId: parent._id },
        {
          $set: {
            planCode: 'premium_monthly',
            status: 'active',
            startDate: new Date(pastDate.getTime() - 30 * 24 * 60 * 60 * 1000),
            endDate: pastDate,
          },
        },
        { upsert: true }
      );

      const res = await request(adminApp)
        .get('/api/v1/admin/users?search=Hoang')
        .set('Authorization', `Bearer ${adminToken}`);

      const found = res.body.data.items.find((u) => u.id === parentUser._id.toString());
      expect(found.currentPlan.planCode).toBe('free');
      expect(found.currentPlan.endDate).toBeNull();
    });
  });

  describe('GET /api/v1/admin/users/:id', () => {
    it('returns full parent details, children list, and current subscription', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/users/${parentUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(parentUser._id.toString());
      expect(res.body.data.fullName).toBe('Hoang Vo Parent');
      expect(Array.isArray(res.body.data.children)).toBe(true);
      expect(res.body.data.children.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.children[0].displayName).toBe('Bé Bi');
      expect(res.body.data.subscription).toBeDefined();
    });

    it('returns the activity summary, login methods and only the area of the location', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/users/${parentUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const { data } = res.body;
      expect(data.activity).toEqual({
        connections: 0,
        playdates: { all: 0, upcoming: 0, completed: 0, cancelled: 0 },
        reports: { total: 0, open: 0 },
      });
      expect(data.loginMethods).toEqual(['password']);
      expect(data.activeChildrenCount).toBe(1);
      expect(data.archivedChildrenCount).toBe(0);
      expect(data.isProfileHidden).toBe(false);
      expect(data.connectionPrivacy).toBe('everyone');
      expect(Object.keys(data.location).sort()).toEqual(['area', 'city']);
    });

    it('returns 404 for non-existent user ID', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(adminApp)
        .get(`/api/v1/admin/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/admin/users/:id/status (Lock/Unlock and Security)', () => {
    it('prevents an admin from locking themselves', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/users/${adminUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_LOCK_SELF');
    });

    it('prevents an admin from locking another admin', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/users/${otherAdminUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_LOCK_ADMIN');
    });

    it('locks a parent account, revoking their refresh tokens', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/users/${parentUser._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
      expect(res.body.data).not.toHaveProperty('reason');

      // Verify the user record in database
      const updated = await User.findById(parentUser._id);
      expect(updated.isActive).toBe(false);

      // Verify child public profile is not accessible while parent is locked
      const viewerParentReg = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Viewer Parent',
        email: `viewer-${Date.now()}@example.com`,
        password,
      });
      const viewerToken = viewerParentReg.body.data.tokens.accessToken;

      const publicRes = await request(app)
        .get(`/api/v1/children/${testChild.id}/public-profile`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(publicRes.status).toBe(404);

      // The admin child list explains why the child is not shown in Discovery
      const childrenRes = await request(adminApp)
        .get('/api/v1/admin/children?search=B%C3%A9%20Bi')
        .set('Authorization', `Bearer ${adminToken}`);
      const lockedChild = childrenRes.body.data.items.find((c) => c.id === testChild.id);
      expect(lockedChild.visibility).toBe('parent_locked');
    });

    it('unlocks a parent account successfully', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/users/${parentUser._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(true);

      const updated = await User.findById(parentUser._id);
      expect(updated.isActive).toBe(true);
    });
  });

  describe('GET /api/v1/admin/children', () => {
    it('returns paginated list of all children joined with parent name', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/children?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);

      const found = res.body.data.items.find((c) => c.displayName === 'Bé Bi');
      expect(found).toBeDefined();
      expect(found.parentName).toBe('Hoang Vo Parent');
      expect(found.gender).toBe('boy');
      expect(found.visibility).toBe('visible');
      expect(found.parentUserId).toBe(parentUser._id.toString());
      expect(found).not.toHaveProperty('dateOfBirth');
    });

    it('reports a hidden parent profile as the reason the child is not visible', async () => {
      await Parent.updateOne({ userId: parentUser._id }, { $set: { 'privacySettings.isProfileHidden': true } });
      try {
        const res = await request(adminApp)
          .get(`/api/v1/admin/children/${testChild.id}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.body.data.visibility).toBe('parent_hidden');
        expect(res.body.data.parent.isProfileHidden).toBe(true);
      } finally {
        await Parent.updateOne({ userId: parentUser._id }, { $set: { 'privacySettings.isProfileHidden': false } });
      }
    });

    it('filters children by age in whole years', async () => {
      const ageOf = (dob) => {
        const birth = new Date(dob);
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
        return age;
      };
      const age = ageOf('2020-05-15');

      const inRange = await request(adminApp)
        .get(`/api/v1/admin/children?search=B%C3%A9%20Bi&minAge=${age}&maxAge=${age}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(inRange.body.data.items.some((c) => c.id === testChild.id)).toBe(true);

      const older = await request(adminApp)
        .get(`/api/v1/admin/children?search=B%C3%A9%20Bi&minAge=${age + 1}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(older.body.data.items.some((c) => c.id === testChild.id)).toBe(false);
    });

    it('filters children by gender, search and age range', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/children?gender=boy&search=Bi')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((c) => c.gender === 'boy')).toBe(true);
      expect(res.body.data.items.some((c) => c.displayName.includes('Bi'))).toBe(true);
    });
  });

  // The test database is shared with the suites running in parallel: only invariants and
  // lower bounds from the data created here are checked, not exact totals
  describe('GET /api/v1/admin/users/stats and /children/stats', () => {
    const getStats = async (path) => {
      const res = await request(adminApp).get(`/api/v1/admin/${path}/stats`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      return res.body.data;
    };

    const registerParent = async (label) => {
      const reg = await request(app).post('/api/v1/auth/register').send({
        fullName: `Stats ${label}`,
        email: `stats-${label}-${Date.now()}-${Math.random()}@example.com`,
        password,
      });
      return { token: reg.body.data.tokens.accessToken, userId: reg.body.data.user.id, parentId: reg.body.data.parent.id };
    };

    it('counts parent accounts by status and the Premium ones', async () => {
      const [locked, premium] = await Promise.all([registerParent('locked'), registerParent('premium')]);
      await User.updateOne({ _id: locked.userId }, { $set: { isActive: false } });
      await grantPremium(premium.parentId);

      const stats = await getStats('users');
      expect(stats.total).toBe(stats.active + stats.locked);
      expect(stats.locked).toBeGreaterThanOrEqual(1);
      expect(stats.active).toBeGreaterThanOrEqual(1);
      expect(stats.premium).toBeGreaterThanOrEqual(1);
      // Admin accounts are not parents
      expect(stats.total).toBe(await User.countDocuments({ role: 'parent', deletedAt: null }));
    });

    it('filters parent accounts by Premium in effect', async () => {
      const [premium, free] = await Promise.all([registerParent('only-premium'), registerParent('only-free')]);
      await grantPremium(premium.parentId);
      const list = async (query) => {
        const res = await request(adminApp)
          .get(`/api/v1/admin/users?search=Stats%20only&limit=100&${query}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        return res.body.data.items;
      };

      const premiumItems = await list('isPremium=true');
      expect(premiumItems.map((u) => u.id)).toContain(premium.userId);
      expect(premiumItems.map((u) => u.id)).not.toContain(free.userId);
      expect(premiumItems.every((u) => u.currentPlan.isPremium)).toBe(true);

      const freeItems = await list('isPremium=false');
      expect(freeItems.map((u) => u.id)).toContain(free.userId);
      expect(freeItems.map((u) => u.id)).not.toContain(premium.userId);
    });

    it('counts child profiles by status, including those locked by the Free plan', async () => {
      const parent = await registerParent('kids');
      await grantPremium(parent.parentId);
      const childIds = [];
      for (const name of ['Một', 'Hai', 'Ba']) {
        const res = await request(app)
          .post('/api/v1/children')
          .set('Authorization', `Bearer ${parent.token}`)
          .send({ displayName: `Stats ${name}`, dateOfBirth: '2020-01-01', gender: 'girl' });
        childIds.push(res.body.data.id);
      }
      await request(app).delete(`/api/v1/children/${childIds[2]}`).set('Authorization', `Bearer ${parent.token}`);
      // Premium ends: 2 active children, the newer one is locked
      await Subscription.updateOne({ parentId: parent.parentId }, { $set: { endDate: new Date(Date.now() - 60 * 1000) } });

      const stats = await getStats('children');
      expect(stats.total).toBe(stats.active + stats.archived);
      expect(stats.archived).toBeGreaterThanOrEqual(1);
      expect(stats.planLocked).toBeGreaterThanOrEqual(1);
      expect(stats.planLocked).toBeLessThanOrEqual(stats.active);

      // The same children are listed by the plan-locked filter
      const listIds = async (query) => {
        const res = await request(adminApp)
          .get(`/api/v1/admin/children?search=Stats&limit=100&${query}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        return res.body.data.items;
      };
      const locked = await listIds('isPlanLocked=true');
      expect(locked.map((c) => c.id)).toEqual(expect.arrayContaining([childIds[1]]));
      expect(locked.map((c) => c.id)).not.toContain(childIds[0]);
      expect(locked.every((c) => c.visibility === 'plan_locked')).toBe(true);
      const notLocked = await listIds('isPlanLocked=false');
      expect(notLocked.map((c) => c.id)).toContain(childIds[0]);
      expect(notLocked.map((c) => c.id)).not.toContain(childIds[1]);
    });

    it('rejects a non-boolean status filter', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/children?isPlanLocked=maybe')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    it('requires an admin session', async () => {
      const res = await request(adminApp).get('/api/v1/admin/users/stats');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/admin/children/:id', () => {
    it('returns full child profile and summary of the parent account', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/children/${testChild.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayName).toBe('Bé Bi');
      expect(res.body.data.interests).toEqual(['Lego', 'Vẽ tranh']);
      expect(res.body.data.parent).toBeDefined();
      expect(res.body.data.parent.fullName).toBe('Hoang Vo Parent');
    });
  });

  describe('GET /api/v1/admin/payments', () => {
    it('returns payment history for a given parentId', async () => {
      const parentDoc = await request(adminApp)
        .get(`/api/v1/admin/users/${parentUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const parentId = parentDoc.body.data.parentId;

      const res = await request(adminApp)
        .get(`/api/v1/admin/payments?parentId=${parentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('validates parentId query param', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/payments')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });
});
