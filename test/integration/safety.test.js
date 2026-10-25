import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Connection from '../../src/modules/connection/connection.model.js';
import { CONNECTION_STATUS } from '../../src/modules/connection/connection.constants.js';
import Block from '../../src/modules/safety/block.model.js';
import Report from '../../src/modules/safety/report.model.js';
import { REPORT_CATEGORIES } from '../../src/modules/safety/safety.constants.js';

const register = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Parent ${label}`,
    email: `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    password: 'Password123!',
  });
  return { token: res.body.data.tokens.accessToken, parentId: res.body.data.parent.id };
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Safety Module Integration Tests (/api/v1/safety)', () => {
  let userA;
  let userB;
  let userC;

  beforeAll(async () => {
    [userA, userB, userC] = await Promise.all([
      register('safety-a'),
      register('safety-b'),
      register('safety-c'),
    ]);
  });

  describe('POST /api/v1/safety/reports (and category validation)', () => {
    it('requires category field', async () => {
      const res = await request(app)
        .post('/api/v1/safety/reports')
        .set(auth(userA.token))
        .send({
          reportedUserId: userB.parentId,
          reason: 'Some reason',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid category enum value', async () => {
      const res = await request(app)
        .post('/api/v1/safety/reports')
        .set(auth(userA.token))
        .send({
          reportedUserId: userB.parentId,
          category: 'invalid_category_123',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects self-reporting', async () => {
      const res = await request(app)
        .post('/api/v1/safety/reports')
        .set(auth(userA.token))
        .send({
          reportedUserId: userA.parentId,
          category: REPORT_CATEGORIES.SPAM,
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SELF_REPORT_NOT_ALLOWED');
    });

    it('successfully creates a report with valid category and payload', async () => {
      const res = await request(app)
        .post('/api/v1/safety/reports')
        .set(auth(userA.token))
        .send({
          reportedUserId: userB.parentId,
          category: REPORT_CATEGORIES.HARASSMENT,
          description: 'Spamming unwanted messages',
          evidenceUrls: [],
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.category).toBe(REPORT_CATEGORIES.HARASSMENT);
      expect(res.body.data.reportedUserId).toBe(userB.parentId);
    });

    it('rejects duplicate reports against the same user within 24h', async () => {
      const res = await request(app)
        .post('/api/v1/safety/reports')
        .set(auth(userA.token))
        .send({
          reportedUserId: userB.parentId,
          category: REPORT_CATEGORIES.SPAM,
        });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('REPORT_TOO_FREQUENT');
    });
  });

  describe('Block, Get Blocked Users, and Unblock Flow', () => {
    it('POST /api/v1/safety/block: blocks target parent and removes active connection', async () => {
      // Create an active connection between userA and userC first
      const connection = await Connection.create({
        parents: [userA.parentId, userC.parentId],
        pairKey: [userA.parentId, userC.parentId].sort().join('_'),
        requesterId: userA.parentId,
        recipientId: userC.parentId,
        status: CONNECTION_STATUS.ACCEPTED,
        connectedAt: new Date(),
      });

      const blockRes = await request(app)
        .post('/api/v1/safety/block')
        .set(auth(userA.token))
        .send({
          blockedId: userC.parentId,
          reason: 'Inappropriate behavior',
        });
      expect(blockRes.status).toBe(200);
      expect(blockRes.body.success).toBe(true);

      // Verify connection is removed
      const updatedConn = await Connection.findById(connection._id);
      expect(updatedConn.status).toBe(CONNECTION_STATUS.REMOVED);
      expect(updatedConn.removedAt).toBeDefined();
    });

    it('GET /api/v1/safety/blocked-users: returns paginated list of blocked users for current user only', async () => {
      const res = await request(app)
        .get('/api/v1/safety/blocked-users?page=1&limit=10')
        .set(auth(userA.token));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeDefined();
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);

      const blockedItem = res.body.data.items.find((i) => i.parentId === userC.parentId);
      expect(blockedItem).toBeDefined();
      expect(blockedItem.displayName).toBeDefined();
      expect(blockedItem.reason).toBe('Inappropriate behavior');
      expect(blockedItem.blockedAt).toBeDefined();

      // userC's blocked-users list should NOT contain userA (one direction only)
      const resC = await request(app)
        .get('/api/v1/safety/blocked-users')
        .set(auth(userC.token));
      expect(resC.status).toBe(200);
      expect(resC.body.data.items.find((i) => i.parentId === userA.parentId)).toBeUndefined();
    });

    it('DELETE /api/v1/safety/unblock/:id: unblocks parent and removes from blocked-users list', async () => {
      const unblockRes = await request(app)
        .delete(`/api/v1/safety/unblock/${userC.parentId}`)
        .set(auth(userA.token));
      expect(unblockRes.status).toBe(200);
      expect(unblockRes.body.success).toBe(true);

      // Immediately removed from blocked-users list
      const listRes = await request(app)
        .get('/api/v1/safety/blocked-users')
        .set(auth(userA.token));
      expect(listRes.body.data.items.find((i) => i.parentId === userC.parentId)).toBeUndefined();

      // Connection is NOT restored (still removed)
      const existingConn = await Connection.findOne({
        parents: { $all: [userA.parentId, userC.parentId] },
      });
      expect(existingConn.status).toBe(CONNECTION_STATUS.REMOVED);
    });
  });
});
