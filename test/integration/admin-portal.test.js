import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Child from '../../src/modules/child/child.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import RescheduleRequest from '../../src/modules/playdate/reschedule-request.model.js';

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

describe('Admin Playdates & Connections Oversight', () => {
  const password = 'AdminPortal123!';
  let adminToken = '';
  let parentA, parentB;
  let childA, childB;
  let upcomingPlaydate, completedPlaydate;
  let pendingConnection, acceptedConnection;

  beforeAll(async () => {
    const adminEmail = `admin-oversight-${Date.now()}@buddylink.com`;
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ email: adminEmail, passwordHash, role: 'admin', isActive: true });

    const adminLogin = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminEmail, password });
    adminToken = adminLogin.body.data.tokens.accessToken;

    // Register 2 parents
    const regA = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Host Parent Alpha',
      email: `alpha-${Date.now()}@example.com`,
      password,
    });
    parentA = regA.body.data.parent;

    const regB = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Invited Parent Beta',
      email: `beta-${Date.now()}@example.com`,
      password,
    });
    parentB = regB.body.data.parent;

    // Create children
    childA = await Child.create({
      parentId: parentA.id,
      displayName: 'Child Alpha',
      dateOfBirth: new Date('2020-01-01'),
      gender: 'boy',
      interests: ['Drawing'],
    });
    childB = await Child.create({
      parentId: parentB.id,
      displayName: 'Child Beta',
      dateOfBirth: new Date('2020-05-01'),
      gender: 'girl',
      interests: ['Music'],
    });

    // Create Playdates
    upcomingPlaydate = await Playdate.create({
      hostParentId: parentA.id,
      hostChildId: childA._id,
      participants: [
        {
          parentId: parentB.id,
          childId: childB._id,
          status: 'accepted',
          respondedAt: new Date(),
        },
      ],
      scheduledDate: new Date('2026-11-15'),
      time: '10:00',
      activity: 'Lego Building Workshop',
      location: {
        name: 'Alpha Kids Club',
        address: '100 Main St, District 1',
      },
      note: 'Bring your favorite sets',
      status: 'upcoming',
    });

    // Add a pending reschedule request to upcomingPlaydate
    await RescheduleRequest.create({
      playdateId: upcomingPlaydate._id,
      requestedBy: parentA.id,
      newDate: new Date('2026-11-16'),
      newStartTime: '11:00',
      reason: 'Need one hour later',
      status: 'pending',
      responses: [
        {
          parentId: parentB.id,
          status: 'pending',
        },
      ],
    });

    completedPlaydate = await Playdate.create({
      hostParentId: parentA.id,
      hostChildId: childA._id,
      participants: [
        {
          parentId: parentB.id,
          childId: childB._id,
          status: 'accepted',
          respondedAt: new Date(),
        },
      ],
      scheduledDate: new Date('2026-10-01'),
      time: '14:00',
      activity: 'Park Picnic',
      location: {
        name: 'Central Park Garden',
        address: '200 Park Ave',
      },
      status: 'completed',
      completedAt: new Date('2026-10-01T16:00:00Z'),
    });

    // Create Connections
    pendingConnection = await Connection.create({
      parents: [parentA.id, parentB.id],
      requesterId: parentA.id,
      recipientId: parentB.id,
      status: 'pending',
    });

    const regC = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Third Parent Gamma',
      email: `gamma-${Date.now()}@example.com`,
      password,
    });
    const parentC = regC.body.data.parent;

    acceptedConnection = await Connection.create({
      parents: [parentA.id, parentC.id],
      requesterId: parentA.id,
      recipientId: parentC.id,
      status: 'accepted',
      connectedAt: new Date(),
    });
  });

  describe('Playdates Oversight', () => {
    it('GET /api/v1/admin/playdates returns paginated list of playdates', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/playdates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();

      const item = res.body.data.items.find((p) => p.id === upcomingPlaydate._id.toString());
      expect(item).toBeDefined();
      expect(item.activity).toBe('Lego Building Workshop');
      expect(item.locationName).toBe('Alpha Kids Club');
      expect(item.host.parent.fullName).toBe('Host Parent Alpha');
      expect(item.host.child.displayName).toBe('Child Alpha');
      expect(item.numberOfParticipants).toBe(1);
      expect(item.status).toBe('upcoming');
    });

    it('filters playdates by status', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/playdates?status=completed')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((p) => p.status === 'completed')).toBe(true);
      const found = res.body.data.items.some((p) => p.id === completedPlaydate._id.toString());
      expect(found).toBe(true);
    });

    it('searches playdates by activity, location or host name', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/playdates?search=Lego')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((p) => p.activity.includes('Lego'))).toBe(true);

      const resHost = await request(adminApp)
        .get('/api/v1/admin/playdates?search=Alpha')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(resHost.status).toBe(200);
      expect(resHost.body.data.items.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/admin/playdates/:id returns full detail including reschedule request', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/playdates/${upcomingPlaydate._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(upcomingPlaydate._id.toString());
      expect(res.body.data.participants).toHaveLength(1);
      expect(res.body.data.participants[0].parent.fullName).toBe('Invited Parent Beta');
      expect(res.body.data.participants[0].status).toBe('accepted');
      expect(res.body.data.pendingReschedule).toBeDefined();
      expect(res.body.data.pendingReschedule.reason).toBe('Need one hour later');
    });

    it('PATCH /api/v1/admin/playdates/:id/cancel requires reason and force-cancels upcoming playdate', async () => {
      const noReason = await request(adminApp)
        .patch(`/api/v1/admin/playdates/${upcomingPlaydate._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(noReason.status).toBe(400);

      const res = await request(adminApp)
        .patch(`/api/v1/admin/playdates/${upcomingPlaydate._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Safety violation reported by user' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(res.body.data.cancellation.cancelledByAdmin).toBe(true);
      expect(res.body.data.cancellation.reason).toBe('Safety violation reported by user');

      // Verify pending reschedule was cancelled
      const resched = await RescheduleRequest.findOne({ playdateId: upcomingPlaydate._id });
      expect(resched.status).toBe('cancelled');
    });

    it('PATCH /api/v1/admin/playdates/:id/cancel returns 400 if already cancelled', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/playdates/${upcomingPlaydate._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Trying again' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ALREADY_CANCELLED');
    });

    it('PATCH /api/v1/admin/playdates/:id/cancel returns 400 if completed', async () => {
      const res = await request(adminApp)
        .patch(`/api/v1/admin/playdates/${completedPlaydate._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Cannot cancel completed' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PLAYDATE_STATUS');
    });
  });

  describe('Connections Oversight', () => {
    it('GET /api/v1/admin/connections returns paginated list of connections', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/connections')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();

      const item = res.body.data.items.find((c) => c.id === pendingConnection._id.toString());
      expect(item).toBeDefined();
      expect(item.requester.fullName).toBe('Host Parent Alpha');
      expect(item.recipient.fullName).toBe('Invited Parent Beta');
      expect(item.status).toBe('pending');
    });

    it('filters connections by status', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/connections?status=accepted')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.every((c) => c.status === 'accepted')).toBe(true);
      expect(res.body.data.items.some((c) => c.id === acceptedConnection._id.toString())).toBe(true);
    });

    it('searches connections by parent name', async () => {
      const res = await request(adminApp)
        .get('/api/v1/admin/connections?search=Gamma')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.some((c) => c.id === acceptedConnection._id.toString())).toBe(true);
    });

    it('GET /api/v1/admin/connections/:id returns detail with parent user info', async () => {
      const res = await request(adminApp)
        .get(`/api/v1/admin/connections/${pendingConnection._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(pendingConnection._id.toString());
      expect(res.body.data.requester.fullName).toBe('Host Parent Alpha');
      expect(res.body.data.requester.isActive).toBe(true);
      expect(res.body.data.requester.userId).toBeDefined();
      expect(res.body.data.recipient.fullName).toBe('Invited Parent Beta');
      expect(res.body.data.recipient.isActive).toBe(true);
    });

    it('DELETE /api/v1/admin/connections/:id soft-removes connection', async () => {
      const res = await request(adminApp)
        .delete(`/api/v1/admin/connections/${pendingConnection._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Dispute between parents' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('removed');
      expect(res.body.data.removedAt).toBeDefined();
      expect(res.body.data.removedByAdmin).toBe(true);
      expect(res.body.data.removalReason).toBe('Dispute between parents');
    });

    it('DELETE /api/v1/admin/connections/:id returns 400 if already removed', async () => {
      const res = await request(adminApp)
        .delete(`/api/v1/admin/connections/${pendingConnection._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CONNECTION_STATE');
    });
  });
});
