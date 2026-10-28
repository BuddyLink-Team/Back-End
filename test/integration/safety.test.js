import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../src/app.js';
import Connection from '../../src/modules/connection/connection.model.js';
import connectionService from '../../src/modules/connection/connection.service.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import Message from '../../src/modules/chat/message.model.js';
import { CONVERSATION_TYPES } from '../../src/modules/chat/chat.constants.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import { CONNECTION_STATUS } from '../../src/modules/connection/connection.constants.js';
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
      // Moderation fields stay internal
      expect(res.body.data).not.toHaveProperty('adminNotes');
      expect(res.body.data).not.toHaveProperty('resolvedBy');
      expect(res.body.data).not.toHaveProperty('reporterId');
    });

    it('is no longer served on the old POST /api/v1/safety/report route', async () => {
      const res = await request(app)
        .post('/api/v1/safety/report')
        .set(auth(userA.token))
        .send({ reportedUserId: userC.parentId, category: REPORT_CATEGORIES.SPAM });
      expect(res.status).toBe(404);
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

  describe('Report targets (message / playdate)', () => {
    let reporter;
    let sender;
    let other;
    let messageId;

    beforeAll(async () => {
      [reporter, sender, other] = await Promise.all([
        register('target-reporter'),
        register('target-sender'),
        register('target-other'),
      ]);
      const conversation = await Conversation.create({
        type: CONVERSATION_TYPES.DIRECT,
        participants: [reporter.parentId, sender.parentId],
      });
      const message = await Message.create({
        conversationId: conversation._id,
        senderId: sender.parentId,
        content: 'Rude message',
      });
      messageId = message._id.toString();
    });

    const report = (token, body) =>
      request(app)
        .post('/api/v1/safety/reports')
        .set(auth(token))
        .send({ category: REPORT_CATEGORIES.HARASSMENT, ...body });

    it('requires the message of a message report', async () => {
      const res = await report(reporter.token, { reportedUserId: sender.parentId, targetType: 'message' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('REPORT_TARGET_REQUIRED');
    });

    it('rejects a message that was not sent by the reported parent', async () => {
      const res = await report(reporter.token, {
        reportedUserId: other.parentId,
        targetType: 'message',
        targetMessageId: messageId,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REPORT_TARGET');
    });

    it('rejects a message from a conversation the reporter is not in', async () => {
      const res = await report(other.token, {
        reportedUserId: sender.parentId,
        targetType: 'message',
        targetMessageId: messageId,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REPORT_TARGET');
    });

    it('reports a message of the reported parent', async () => {
      const res = await report(reporter.token, {
        reportedUserId: sender.parentId,
        targetType: 'message',
        targetMessageId: messageId,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.targetMessageId).toBe(messageId);
    });

    it('reports a playdate against its host only, from one of its families', async () => {
      const playdate = await Playdate.create({
        hostParentId: other.parentId,
        hostChildId: new mongoose.Types.ObjectId(),
        participants: [{ parentId: sender.parentId, childId: new mongoose.Types.ObjectId(), status: 'accepted' }],
        scheduledDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        time: '09:00',
        activity: 'Picnic',
        location: { name: 'Park', address: 'District 1' },
      });
      const playdateId = playdate._id.toString();

      const notHost = await report(other.token, {
        reportedUserId: sender.parentId,
        targetType: 'playdate',
        targetPlaydateId: playdateId,
      });
      expect(notHost.status).toBe(400);
      expect(notHost.body.error.code).toBe('INVALID_REPORT_TARGET');

      const notMember = await report(reporter.token, {
        reportedUserId: other.parentId,
        targetType: 'playdate',
        targetPlaydateId: playdateId,
      });
      expect(notMember.status).toBe(400);
      expect(notMember.body.error.code).toBe('INVALID_REPORT_TARGET');

      const missing = await report(sender.token, {
        reportedUserId: other.parentId,
        targetType: 'playdate',
        targetPlaydateId: new mongoose.Types.ObjectId().toString(),
      });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('REPORT_TARGET_NOT_FOUND');

      const ok = await report(sender.token, {
        reportedUserId: other.parentId,
        targetType: 'playdate',
        targetPlaydateId: playdateId,
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.targetPlaydateId).toBe(playdateId);
    });
  });

  describe('Report model', () => {
    it('reads a report created before categories existed as "other"', async () => {
      const { _id } = await Report.create({
        reporterId: userB.parentId,
        reportedUserId: userC.parentId,
        targetType: 'user',
        category: REPORT_CATEGORIES.SPAM,
      });
      await Report.collection.updateOne({ _id }, { $unset: { category: '' } });

      const legacy = await Report.findById(_id);
      expect(legacy.category).toBe(REPORT_CATEGORIES.OTHER);
      legacy.status = 'reviewing';
      await expect(legacy.save()).resolves.toBeDefined();
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
      expect(blockRes.body.data).toEqual(
        expect.objectContaining({ parentId: userC.parentId, reason: 'Inappropriate behavior' }),
      );

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
      expect(blockedItem.fullName).toBe('Parent safety-c');
      expect(blockedItem.reason).toBe('Inappropriate behavior');
      expect(blockedItem.blockedAt).toBeDefined();

      // userC's blocked-users list should NOT contain userA (one direction only)
      const resC = await request(app)
        .get('/api/v1/safety/blocked-users')
        .set(auth(userC.token));
      expect(resC.status).toBe(200);
      expect(resC.body.data.items.find((i) => i.parentId === userA.parentId)).toBeUndefined();
    });

    it('GET /api/v1/safety/blocked-users?search: filters by blocked parent name on the server', async () => {
      const match = await request(app)
        .get('/api/v1/safety/blocked-users?search=safety-c')
        .set(auth(userA.token));
      expect(match.status).toBe(200);
      expect(match.body.data.items.map((i) => i.parentId)).toEqual([userC.parentId]);
      expect(match.body.data.pagination.total).toBe(1);

      const noMatch = await request(app)
        .get('/api/v1/safety/blocked-users?search=nobody-here')
        .set(auth(userA.token));
      expect(noMatch.body.data.items).toHaveLength(0);
      expect(noMatch.body.data.pagination.total).toBe(0);
    });

    it('POST /api/v1/safety/block: reports BLOCK_INCOMPLETE when the connection cannot be removed', async () => {
      const spy = jest
        .spyOn(connectionService, 'removeActiveConnectionBetween')
        .mockRejectedValueOnce(new Error('database unavailable'));
      try {
        const res = await request(app)
          .post('/api/v1/safety/block')
          .set(auth(userB.token))
          .send({ blockedId: userC.parentId });
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('BLOCK_INCOMPLETE');
      } finally {
        spy.mockRestore();
      }

      // Blocking again is safe and completes the block
      const retry = await request(app)
        .post('/api/v1/safety/block')
        .set(auth(userB.token))
        .send({ blockedId: userC.parentId });
      expect(retry.status).toBe(200);
      await request(app).delete(`/api/v1/safety/unblock/${userC.parentId}`).set(auth(userB.token));
    });

    it('DELETE /api/v1/safety/block/:blockedId: old route is no longer served', async () => {
      const res = await request(app).delete(`/api/v1/safety/block/${userC.parentId}`).set(auth(userA.token));
      expect(res.status).toBe(404);
    });

    it('DELETE /api/v1/safety/unblock/:id: rejects an invalid id', async () => {
      const res = await request(app).delete('/api/v1/safety/unblock/not-an-id').set(auth(userA.token));
      expect(res.status).toBe(400);
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
