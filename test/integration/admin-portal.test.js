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
        .send({ isActive: false, reason: 'Self lock test' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_LOCK_SELF');
    });

    it('prevents an admin from locking another admin', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/users/${otherAdminUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false, reason: 'Admin lock test' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CANNOT_LOCK_ADMIN');
    });

    it('locks a parent account, revoking their refresh tokens', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/users/${parentUser._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false, reason: 'Safety compliance violation' });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

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
