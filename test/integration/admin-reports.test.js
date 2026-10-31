import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Report from '../../src/modules/safety/report.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import Message from '../../src/modules/chat/message.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import chatRepository from '../../src/modules/chat/chat.repository.js';
import ChatDTO from '../../src/modules/chat/chat.dto.js';
import { DELETED_MESSAGE_PLACEHOLDER, SOCKET_EVENTS } from '../../src/modules/chat/chat.constants.js';
import safetyService from '../../src/modules/safety/safety.service.js';
import userService from '../../src/modules/user/user.service.js';
import { onUserEvent, USER_EVENTS } from '../../src/modules/user/user.events.js';
import { broadcastAccountLocked, broadcastMessageDeleted } from '../../src/sockets/moderation.broadcast.js';
import {
  CATEGORY_TO_SEVERITY,
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  REPORT_STATUS,
  REPORT_TARGET_TYPES,
} from '../../src/modules/safety/safety.constants.js';

const REPORTS_URL = '/api/v1/admin/reports';
const VALID_NOTES = 'Đã xác minh nội dung báo cáo và xử lý theo quy định.';

describe('Admin Safety & Reports Moderation (/api/v1/admin/reports)', () => {
  const password = 'AdminPassword123!';
  const runId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  let passwordHash = '';
  let parentCount = 0;
  let adminUser = null;
  let adminToken = '';

  const created = { users: [], parents: [], reports: [], children: [], conversations: [], playdates: [] };

  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);
  const get = (path = '') => asAdmin(request(adminApp).get(`${REPORTS_URL}${path}`));
  const post = (path, body) => asAdmin(request(adminApp).post(`${REPORTS_URL}${path}`)).send(body);
  const patch = (path, body) => asAdmin(request(adminApp).patch(`${REPORTS_URL}${path}`)).send(body);

  const createParent = async (fullName) => {
    parentCount += 1;
    const user = await User.create({
      email: `moderation-${runId}-${parentCount}@example.com`,
      passwordHash,
      role: 'parent',
      isActive: true,
    });
    const parent = await Parent.create({ userId: user._id, fullName });
    created.users.push(user._id);
    created.parents.push(parent._id);
    return { user, parent };
  };

  const createReport = async (reporter, reported, overrides = {}) => {
    const report = await Report.create({
      reporterId: reporter.parent._id,
      reportedUserId: reported.parent._id,
      targetType: REPORT_TARGET_TYPES.USER,
      category: REPORT_CATEGORIES.HARASSMENT,
      severity: REPORT_SEVERITY.HIGH,
      reason: `Quấy rối ${runId}`,
      description: 'Liên tục gửi tin nhắn gây phiền hà',
      status: REPORT_STATUS.PENDING,
      ...overrides,
    });
    created.reports.push(report._id);
    return report;
  };

  const createReviewingReport = async (reporter, reported, overrides = {}) => {
    const report = await createReport(reporter, reported, overrides);
    const res = await patch(`/${report._id}/review`, { action: 'claim' });
    expect(res.status).toBe(200);
    return report;
  };

  const createPair = async () => [await createParent(`Reporter ${runId}`), await createParent(`Reported ${runId}`)];

  // A conversation between both parents with 12 messages; returns the one in the middle
  const createChatHistory = async (reporter, reported) => {
    const conversation = await Conversation.create({
      type: 'direct',
      participants: [reporter.parent._id, reported.parent._id],
    });
    created.conversations.push(conversation._id);
    const base = Date.now() - 60 * 60 * 1000;
    const messages = [];
    for (let i = 0; i < 12; i += 1) {
      const message = await Message.create({
        conversationId: conversation._id,
        senderId: reported.parent._id,
        type: 'text',
        content: `Tin nhắn ${i}`,
      });
      await Message.collection.updateOne({ _id: message._id }, { $set: { createdAt: new Date(base + i * 1000) } });
      messages.push(message);
    }
    return { conversation, messages, target: messages[6] };
  };

  const notificationsOf = (user) => Notification.find({ recipientId: user._id }).sort({ createdAt: -1 }).lean();

  const login = (user) => request(app).post('/api/v1/auth/login').send({ email: user.email, password });

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
    adminUser = await User.create({
      email: `admin-report-${runId}@buddylink.com`,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
    const adminLogin = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminUser.email, password });
    adminToken = adminLogin.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await User.deleteMany({ _id: { $in: [adminUser._id, ...created.users] } });
    await Parent.deleteMany({ _id: { $in: created.parents } });
    await Report.deleteMany({ _id: { $in: created.reports } });
    await Child.deleteMany({ _id: { $in: created.children } });
    await Message.deleteMany({ conversationId: { $in: created.conversations } });
    await Conversation.deleteMany({ _id: { $in: created.conversations } });
    await Playdate.deleteMany({ _id: { $in: created.playdates } });
    await Notification.deleteMany({ recipientId: { $in: created.users } });
  });

  describe('access', () => {
    it('rejects a request without an admin token', async () => {
      const res = await request(adminApp).get(REPORTS_URL);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /reports', () => {
    it('sorts by severity, then oldest first, and flags overdue reports', async () => {
      const [reporter, reported] = await createPair();
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const tag = `order-${runId}`;

      const low = await createReport(reporter, reported, { severity: REPORT_SEVERITY.LOW, reason: tag });
      const recentCritical = await createReport(reporter, reported, { severity: REPORT_SEVERITY.CRITICAL, reason: tag });
      const oldCritical = await createReport(reporter, reported, { severity: REPORT_SEVERITY.CRITICAL, reason: tag });
      const oldLow = await createReport(reporter, reported, { severity: REPORT_SEVERITY.LOW, reason: tag });
      const recentHigh = await createReport(reporter, reported, { severity: REPORT_SEVERITY.HIGH, reason: tag });
      await Report.collection.updateOne({ _id: oldCritical._id }, { $set: { createdAt: threeHoursAgo } });
      await Report.collection.updateOne({ _id: oldLow._id }, { $set: { createdAt: twoDaysAgo } });
      await Report.collection.updateOne({ _id: recentHigh._id }, { $set: { createdAt: threeHoursAgo } });

      const res = await get(`?search=${tag}`);

      expect(res.status).toBe(200);
      const items = res.body.data.items;
      expect(items.map((item) => item.id)).toEqual(
        [oldCritical, recentCritical, recentHigh, oldLow, low].map((report) => report._id.toString())
      );
      const overdueById = Object.fromEntries(items.map((item) => [item.id, item.isOverdue]));
      expect(overdueById[oldCritical._id.toString()]).toBe(true); // > 2h, critical
      expect(overdueById[recentHigh._id.toString()]).toBe(false); // 3h is fine below critical
      expect(overdueById[oldLow._id.toString()]).toBe(true); // > 24h

      const overdueOnly = await get(`?search=${tag}&isOverdue=true`);
      expect(overdueOnly.body.data.items.map((item) => item.id).sort()).toEqual(
        [oldCritical, oldLow].map((report) => report._id.toString()).sort()
      );

      const newest = await get(`?search=${tag}&sort=newest`);
      expect(newest.body.data.items.at(-1).id).toBe(oldLow._id.toString());
    });

    it('filters by status, severity, category, target type, assignee and date range', async () => {
      const [reporter, reported] = await createPair();
      const tag = `filter-${runId}`;
      const spam = await createReport(reporter, reported, {
        reason: tag,
        category: REPORT_CATEGORIES.SPAM,
        severity: REPORT_SEVERITY.LOW,
      });
      const claimed = await createReviewingReport(reporter, reported, { reason: tag });

      const idsOf = async (query) => (await get(`?search=${tag}&${query}`)).body.data.items.map((item) => item.id);
      const spamId = spam._id.toString();
      const claimedId = claimed._id.toString();

      expect(await idsOf('status=pending')).toEqual([spamId]);
      expect(await idsOf('status=reviewing')).toEqual([claimedId]);
      expect(await idsOf('severity=low')).toEqual([spamId]);
      expect(await idsOf('category=spam')).toEqual([spamId]);
      expect(await idsOf('targetType=message')).toEqual([]);
      expect(await idsOf('assignedTo=me')).toEqual([claimedId]);
      expect(await idsOf(`assignedTo=${adminUser._id}`)).toEqual([claimedId]);
      expect(await idsOf('toDate=2020-01-01')).toEqual([]);
      expect((await idsOf('fromDate=2020-01-01')).length).toBe(2);
    });

    it('finds a report by the name or email of its parents and returns what the export needs', async () => {
      const reporter = await createParent(`Người báo cáo ${runId}`);
      const reported = await createParent(`Người vi phạm ${runId}`);
      const report = await createReviewingReport(reporter, reported, { reason: 'x', evidenceUrls: ['https://cdn/a.png'] });

      const byName = await get(`?search=${encodeURIComponent(`Người vi phạm ${runId}`)}`);
      const byEmail = await get(`?search=${encodeURIComponent(reporter.user.email)}`);

      expect(byName.body.data.items.map((item) => item.id)).toContain(report._id.toString());
      expect(byEmail.body.data.items.map((item) => item.id)).toContain(report._id.toString());

      const item = byName.body.data.items.find((row) => row.id === report._id.toString());
      expect(item.reporter.email).toBe(reporter.user.email);
      expect(item.reportedUser.email).toBe(reported.user.email);
      expect(item.evidenceUrls).toEqual(['https://cdn/a.png']);
      expect(item.description).toBeTruthy();
      expect(item.assignedTo.email).toBe(adminUser.email);
    });

    it('treats the search text literally', async () => {
      const res = await get('?search=(');
      expect(res.status).toBe(200);
    });

    it('rejects an unknown sort and assignee', async () => {
      expect((await get('?sort=random')).status).toBe(400);
      expect((await get('?assignedTo=someone')).status).toBe(400);
    });
  });

  describe('GET /reports/stats', () => {
    it('counts by status and severity, overdue and the average resolution time', async () => {
      const [reporter, reported] = await createPair();
      const before = (await get('/stats')).body.data;

      const report = await createReviewingReport(reporter, reported, { severity: REPORT_SEVERITY.CRITICAL });
      await Report.collection.updateOne(
        { _id: report._id },
        { $set: { createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000) } }
      );
      await createReport(reporter, reported, { severity: REPORT_SEVERITY.LOW });

      const res = await get('/stats');

      expect(res.status).toBe(200);
      const stats = res.body.data;
      expect(stats.reviewing).toBeGreaterThanOrEqual(before.reviewing + 1);
      expect(stats.pending).toBeGreaterThanOrEqual(before.pending + 1);
      expect(stats.bySeverity.critical).toBeGreaterThanOrEqual(before.bySeverity.critical + 1);
      expect(stats.overdue).toBeGreaterThanOrEqual(before.overdue + 1);
      expect(stats).toEqual(
        expect.objectContaining({
          resolved: expect.any(Number),
          dismissed: expect.any(Number),
          total: expect.any(Number),
          resolvedThisWeek: expect.any(Number),
          avgResolutionHours: expect.any(Number),
        })
      );

      await patch(`/${report._id}/resolve`, { status: 'resolved', resolution: 'no_action', adminNotes: VALID_NOTES });
      const after = (await get('/stats')).body.data;
      expect(after.avgResolutionHours).toBeGreaterThan(0);
      expect(after.resolvedThisWeek).toBeGreaterThanOrEqual(before.resolvedThisWeek + 1);
    });

    it('rejects an invalid date', async () => {
      expect((await get('/stats?fromDate=not-a-date')).status).toBe(400);
    });
  });

  describe('GET /reports/:id', () => {
    it('returns the reported message with 5 messages on each side, and the moderators by name', async () => {
      const [reporter, reported] = await createPair();
      const { target, messages } = await createChatHistory(reporter, reported);
      const report = await createReviewingReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.MESSAGE,
        targetMessageId: target._id,
      });

      const res = await get(`/${report._id}`);

      expect(res.status).toBe(200);
      const { targetContext, history, assignedTo } = res.body.data;
      expect(targetContext.reportedMessage.id).toBe(target._id.toString());
      expect(targetContext.surroundingMessages.map((message) => message.content)).toEqual(
        messages.slice(1, 12).map((message) => message.content)
      );
      expect(history[0].by.email).toBe(adminUser.email);
      expect(assignedTo.email).toBe(adminUser.email);
    });

    it('returns the reported user history and related open reports', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReport(reporter, reported);
      const open = await createReport(reporter, reported);
      const past = await createReviewingReport(reporter, reported);
      await post(`/${past._id}/action`, { type: 'warn', note: 'Lần đầu' });
      await patch(`/${past._id}/resolve`, { status: 'resolved', resolution: 'action_taken', adminNotes: VALID_NOTES });

      const { data } = (await get(`/${report._id}`)).body;

      expect(data.reporter.totalReportsSubmitted).toBe(3);
      expect(data.relatedOpenReports.map((item) => item.id)).toEqual([open._id.toString()]);
      expect(data.reportedUser.pastReports.map((item) => item.id).sort()).toEqual(
        [open._id.toString(), past._id.toString()].sort()
      );
      expect(data.reportedUser.previousSanctions.map((item) => item.type)).toEqual(['warn']);
      expect(data.reportedUser.strikeCount).toBe(1);
    });

    it('returns playdate details, and no context when the target is gone', async () => {
      const [reporter, reported] = await createPair();
      const child = await Child.create({
        parentId: reported.parent._id,
        displayName: 'Bé Na',
        dateOfBirth: new Date('2020-01-01'),
        gender: 'girl',
      });
      created.children.push(child._id);
      const playdate = await Playdate.create({
        hostParentId: reported.parent._id,
        hostChildId: child._id,
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        time: '09:00',
        activity: 'Picnic',
        location: { name: 'Công viên', address: 'Đà Nẵng' },
      });
      created.playdates.push(playdate._id);
      const report = await createReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.PLAYDATE,
        targetPlaydateId: playdate._id,
      });
      const gone = await createReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.PLAYDATE,
        targetPlaydateId: reported.parent._id,
      });

      const { targetContext } = (await get(`/${report._id}`)).body.data;
      expect(targetContext.playdate.activity).toBe('Picnic');
      expect(targetContext.playdate.host.parent.fullName).toBe(reported.parent.fullName);

      expect((await get(`/${gone._id}`)).body.data.targetContext).toBeNull();
    });

    it('answers 404 for an unknown report', async () => {
      const res = await get(`/${adminUser._id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('REPORT_NOT_FOUND');
    });
  });

  describe('PATCH /reports/:id/review and severity', () => {
    it('claims a pending report and logs it', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReport(reporter, reported);

      const res = await patch(`/${report._id}/review`, { action: 'claim' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reviewing');
      expect(res.body.data.assignedTo.id).toBe(adminUser._id.toString());
      expect(res.body.data.history.at(-1)).toEqual(
        expect.objectContaining({ eventType: 'claim', fromStatus: 'pending', toStatus: 'reviewing' })
      );
    });

    it('changes the severity only while reviewing, and logs it', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReport(reporter, reported);

      const pendingRes = await patch(`/${report._id}/severity`, { severity: 'critical' });
      expect(pendingRes.status).toBe(400);

      await patch(`/${report._id}/review`, { action: 'claim' });
      const res = await patch(`/${report._id}/severity`, { severity: 'critical' });

      expect(res.status).toBe(200);
      expect(res.body.data.severity).toBe('critical');
      expect(res.body.data.history.at(-1).eventType).toBe('severity_change');
    });
  });

  describe('POST /reports/:id/action', () => {
    it('needs the review to have started', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReport(reporter, reported);

      const res = await post(`/${report._id}/action`, { type: 'warn' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('only accepts real sanctions', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      expect((await post(`/${report._id}/action`, { type: 'no_action' })).status).toBe(400);
      expect((await post(`/${report._id}/action`, { type: 'dismiss' })).status).toBe(400);
    });

    it('warn: adds a strike, notifies with a generic reason, and does not run twice', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);

      const res = await post(`/${report._id}/action`, { type: 'warn', note: 'Cảnh cáo lần 1' });

      expect(res.status).toBe(200);
      expect(res.body.data.reportedUser.strikeCount).toBe(1);
      expect(res.body.data.actions[0]).toEqual(
        expect.objectContaining({ type: 'warn', note: 'Cảnh cáo lần 1' })
      );
      expect(res.body.data.actions[0].performedBy.email).toBe(adminUser.email);
      expect(res.body.data.history.at(-1).eventType).toBe('action_applied');

      const [notification] = await notificationsOf(reported.user);
      expect(notification.title).toBe('Cảnh cáo vi phạm an toàn');
      expect(notification.body).toContain('quấy rối');
      expect(notification.body).not.toContain('harassment');
      expect(notification.data.reportId.toString()).toBe(report._id.toString());

      const again = await post(`/${report._id}/action`, { type: 'warn' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ACTION_ALREADY_APPLIED');
      expect((await User.findById(reported.user._id)).strikeCount).toBe(1);
    });

    it('delete_message: shows a placeholder in the history and the preview, and does not run twice', async () => {
      const [reporter, reported] = await createPair();
      const { conversation, messages } = await createChatHistory(reporter, reported);
      const lastMessage = messages[11];
      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessage: {
              messageId: lastMessage._id,
              senderId: reported.parent._id,
              content: lastMessage.content,
              type: 'text',
              sentAt: new Date(),
            },
          },
        }
      );
      const report = await createReviewingReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.MESSAGE,
        targetMessageId: lastMessage._id,
      });

      const res = await post(`/${report._id}/action`, { type: 'delete_message' });

      expect(res.status).toBe(200);
      // The moderator can still read what was reported
      expect(res.body.data.targetContext.reportedMessage.content).toBe(lastMessage.content);
      expect(res.body.data.targetContext.reportedMessage.isDeleted).toBe(true);

      const history = await chatRepository.findMessages(conversation._id, { limit: 50 });
      const shown = ChatDTO.toMessageResponse(history.find((m) => String(m._id) === String(lastMessage._id)), reporter.parent._id);
      expect(shown.isDeleted).toBe(true);
      expect(shown.content).toBe(DELETED_MESSAGE_PLACEHOLDER);

      const updatedConversation = await Conversation.findById(conversation._id).lean();
      expect(updatedConversation.lastMessage.content).toBe(DELETED_MESSAGE_PLACEHOLDER);

      // Another report on the same message: the target was already handled
      const other = await createReviewingReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.MESSAGE,
        targetMessageId: lastMessage._id,
      });
      const again = await post(`/${other._id}/action`, { type: 'delete_message' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ACTION_ALREADY_APPLIED');
    });

    it('delete_message: answers TARGET_NOT_FOUND when the message no longer exists, and refuses another target type', async () => {
      const [reporter, reported] = await createPair();
      const missing = await createReviewingReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.MESSAGE,
        targetMessageId: adminUser._id,
      });
      const res = await post(`/${missing._id}/action`, { type: 'delete_message' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TARGET_NOT_FOUND');

      const userReport = await createReviewingReport(reporter, reported);
      const wrongType = await post(`/${userReport._id}/action`, { type: 'delete_message' });
      expect(wrongType.status).toBe(400);
      expect(wrongType.body.error.code).toBe('INVALID_ACTION_TYPE');
    });

    it('cancel_playdate: cancels it once, and answers TARGET_NOT_FOUND when it no longer exists', async () => {
      const [reporter, reported] = await createPair();
      const child = await Child.create({
        parentId: reported.parent._id,
        displayName: 'Bé Bi',
        dateOfBirth: new Date('2020-01-01'),
        gender: 'boy',
      });
      created.children.push(child._id);
      const playdate = await Playdate.create({
        hostParentId: reported.parent._id,
        hostChildId: child._id,
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        time: '09:00',
        activity: 'Picnic',
        location: { name: 'Công viên', address: 'Đà Nẵng' },
      });
      created.playdates.push(playdate._id);
      const overrides = { targetType: REPORT_TARGET_TYPES.PLAYDATE, targetPlaydateId: playdate._id };
      const report = await createReviewingReport(reporter, reported, overrides);

      const res = await post(`/${report._id}/action`, { type: 'cancel_playdate', note: 'Vi phạm an toàn' });

      expect(res.status).toBe(200);
      expect((await Playdate.findById(playdate._id)).status).toBe('cancelled');

      const other = await createReviewingReport(reporter, reported, overrides);
      const again = await post(`/${other._id}/action`, { type: 'cancel_playdate' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ACTION_ALREADY_APPLIED');

      const missing = await createReviewingReport(reporter, reported, {
        targetType: REPORT_TARGET_TYPES.PLAYDATE,
        targetPlaydateId: adminUser._id,
      });
      const missingRes = await post(`/${missing._id}/action`, { type: 'cancel_playdate' });
      expect(missingRes.status).toBe(404);
      expect(missingRes.body.error.code).toBe('TARGET_NOT_FOUND');
    });

    it('suspend: blocks sign-in until it ends, then lifts itself at the next sign-in', async () => {
      const [reporter, reported] = await createPair();
      const statusEvents = [];
      onUserEvent(USER_EVENTS.USER_STATUS_CHANGED, (payload) => {
        if (String(payload.userId) === String(reported.user._id)) statusEvents.push(payload.isActive);
      });
      const report = await createReviewingReport(reporter, reported);

      expect((await post(`/${report._id}/action`, { type: 'suspend' })).status).toBe(400);

      const res = await post(`/${report._id}/action`, { type: 'suspend', durationDays: 3 });

      expect(res.status).toBe(200);
      expect(res.body.data.reportedUser.isActive).toBe(false);
      expect(res.body.data.actions[0].params.durationDays).toBe(3);
      expect(statusEvents).toEqual([false]);

      const [notification] = await notificationsOf(reported.user);
      expect(notification.title).toBe('Tài khoản bị tạm đình chỉ');
      expect(notification.body).toContain('3 ngày');

      const locked = await login(reported.user);
      expect(locked.status).toBe(403);
      expect(locked.body.error.code).toBe('ACCOUNT_DISABLED');

      // Still suspended: suspending again from another report changes nothing
      const other = await createReviewingReport(reporter, reported);
      const again = await post(`/${other._id}/action`, { type: 'suspend', durationDays: 7 });
      expect(again.status).toBe(409);

      await User.updateOne({ _id: reported.user._id }, { $set: { suspensionUntil: new Date(Date.now() - 1000) } });

      const back = await login(reported.user);
      expect(back.status).toBe(200);
      const user = await User.findById(reported.user._id);
      expect(user.isActive).toBe(true);
      expect(user.suspensionUntil).toBeNull();
      expect(statusEvents).toEqual([false, true]);
    });

    it('suspend: the expiry job reactivates accounts that do not come back', async () => {
      const [, reported] = await createPair();
      await User.updateOne(
        { _id: reported.user._id },
        { $set: { isActive: false, suspensionUntil: new Date(Date.now() - 1000) } }
      );
      const [, stillSuspended] = await createPair();
      await User.updateOne(
        { _id: stillSuspended.user._id },
        { $set: { isActive: false, suspensionUntil: new Date(Date.now() + 60 * 60 * 1000) } }
      );

      await userService.liftEndedSuspensions();

      expect((await User.findById(reported.user._id)).isActive).toBe(true);
      expect((await User.findById(stillSuspended.user._id)).isActive).toBe(false);
    });

    it('ban: locks for good, notifies, and cannot be shortened by a suspension', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);

      const res = await post(`/${report._id}/action`, { type: 'ban', note: 'Vi phạm nghiêm trọng' });

      expect(res.status).toBe(200);
      const user = await User.findById(reported.user._id);
      expect(user.isActive).toBe(false);
      expect(user.suspensionUntil).toBeNull();
      expect(user.banReason).toBe('Vi phạm nghiêm trọng');
      expect((await login(reported.user)).status).toBe(403);

      const [notification] = await notificationsOf(reported.user);
      expect(notification.title).toBe('Tài khoản bị khóa vĩnh viễn');

      const other = await createReviewingReport(reporter, reported);
      const suspend = await post(`/${other._id}/action`, { type: 'suspend', durationDays: 3 });
      expect(suspend.status).toBe(409);
      const banAgain = await post(`/${other._id}/action`, { type: 'ban' });
      expect(banAgain.status).toBe(409);
      expect((await User.findById(reported.user._id)).suspensionUntil).toBeNull();

      await userService.liftEndedSuspensions();
      expect((await User.findById(reported.user._id)).isActive).toBe(false);
    });

    it('an admin unlock ends the sanction', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      await post(`/${report._id}/action`, { type: 'suspend', durationDays: 3 });

      const unlock = await asAdmin(
        request(adminApp).patch(`/api/v1/admin/users/${reported.user._id}/status`)
      ).send({ isActive: true });

      expect(unlock.status).toBe(200);
      expect((await User.findById(reported.user._id)).suspensionUntil).toBeNull();
    });
  });

  describe('PATCH /reports/:id/resolve', () => {
    it('needs notes of at least 10 characters', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      const res = await patch(`/${report._id}/resolve`, { status: 'resolved', resolution: 'no_action', adminNotes: 'Ngắn' });
      expect(res.status).toBe(400);
    });

    it('needs an action for action_taken, and a matching status and resolution', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);

      const noAction = await patch(`/${report._id}/resolve`, {
        status: 'resolved',
        resolution: 'action_taken',
        adminNotes: VALID_NOTES,
      });
      expect(noAction.status).toBe(400);
      expect(noAction.body.error.code).toBe('ACTIONS_REQUIRED_FOR_RESOLVE');

      const mismatch = [
        { status: 'dismissed', resolution: 'no_action' },
        { status: 'dismissed', resolution: 'action_taken' },
        { status: 'resolved', resolution: 'dismissed' },
      ];
      for (const body of mismatch) {
        const res = await patch(`/${report._id}/resolve`, { ...body, adminNotes: VALID_NOTES });
        expect(res.status).toBe(400);
      }
    });

    it('a pending report can be dismissed directly but not resolved', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReport(reporter, reported);

      const resolved = await patch(`/${report._id}/resolve`, {
        status: 'resolved',
        resolution: 'no_action',
        adminNotes: VALID_NOTES,
      });
      expect(resolved.status).toBe(400);
      expect(resolved.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const dismissed = await patch(`/${report._id}/resolve`, {
        status: 'dismissed',
        resolution: 'dismissed',
        adminNotes: 'Báo cáo trùng lặp với báo cáo trước.',
      });
      expect(dismissed.status).toBe(200);
      expect(dismissed.body.data.status).toBe('dismissed');
    });

    it('notifies the reporter without revealing the sanction, and sets who closed it', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      await post(`/${report._id}/action`, { type: 'warn' });

      const res = await patch(`/${report._id}/resolve`, {
        status: 'resolved',
        resolution: 'action_taken',
        adminNotes: VALID_NOTES,
      });

      expect(res.status).toBe(200);
      expect(res.body.data.resolvedBy.email).toBe(adminUser.email);
      expect(res.body.data.resolvedAt).toBeTruthy();
      expect(res.body.data.history.at(-1)).toEqual(
        expect.objectContaining({ eventType: 'status_change', fromStatus: 'reviewing', toStatus: 'resolved' })
      );

      const [notification] = await notificationsOf(reporter.user);
      expect(notification.body).toContain('Báo cáo của bạn đã được xử lý');
      expect(notification.body.toLowerCase()).not.toMatch(/cảnh cáo|đình chỉ|khóa/);
    });

    it('tells the reporter a dismissed report was reviewed', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);

      await patch(`/${report._id}/resolve`, { status: 'dismissed', resolution: 'dismissed', adminNotes: VALID_NOTES });

      const [notification] = await notificationsOf(reporter.user);
      expect(notification.body).toContain('đã được xem xét');
    });

    it('a closed report is read-only until reopened', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      await patch(`/${report._id}/resolve`, { status: 'resolved', resolution: 'no_action', adminNotes: VALID_NOTES });

      const resolveAgain = await patch(`/${report._id}/resolve`, {
        status: 'dismissed',
        resolution: 'dismissed',
        adminNotes: VALID_NOTES,
      });
      expect(resolveAgain.status).toBe(409);
      expect(resolveAgain.body.error.code).toBe('REPORT_ALREADY_CLOSED');

      const action = await post(`/${report._id}/action`, { type: 'warn' });
      expect(action.status).toBe(409);
      expect(action.body.error.code).toBe('REPORT_ALREADY_CLOSED');

      expect((await patch(`/${report._id}/severity`, { severity: 'low' })).status).toBe(400);
      expect((await patch(`/${report._id}/review`, { action: 'claim' })).status).toBe(400);
    });

    it('closes related reports with the same ban and note', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      const related = await createReport(reporter, reported);
      const notSelected = await createReport(reporter, reported);
      const [otherReporter, otherReported] = await createPair();
      const foreign = await createReport(otherReporter, otherReported);

      const withoutSanction = await patch(`/${report._id}/resolve`, {
        status: 'resolved',
        resolution: 'no_action',
        adminNotes: VALID_NOTES,
        applyToRelatedReportIds: [related._id],
      });
      expect(withoutSanction.status).toBe(400);
      expect(withoutSanction.body.error.code).toBe('RELATED_REPORTS_REQUIRE_SANCTION');

      await post(`/${report._id}/action`, { type: 'ban', note: 'Vi phạm nhiều lần' });
      const res = await patch(`/${report._id}/resolve`, {
        status: 'resolved',
        resolution: 'action_taken',
        adminNotes: VALID_NOTES,
        applyToRelatedReportIds: [related._id, foreign._id],
      });
      expect(res.status).toBe(200);

      const closed = await Report.findById(related._id).lean();
      expect(closed.status).toBe('resolved');
      expect(closed.resolution).toBe('action_taken');
      expect(closed.adminNotes).toBe(VALID_NOTES);
      expect(closed.actions.map((action) => action.type)).toEqual(['ban']);
      expect(closed.actions[0].note).toBe('Vi phạm nhiều lần');
      expect(closed.history.map((entry) => entry.eventType)).toEqual(['action_applied', 'status_change']);

      expect((await Report.findById(notSelected._id)).status).toBe('pending');
      // Only reports against the same user are closed together
      expect((await Report.findById(foreign._id)).status).toBe('pending');
    });
  });

  describe('PATCH /reports/:id/reopen', () => {
    it('needs a note, keeps the sanctions and logs it', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      await post(`/${report._id}/action`, { type: 'warn' });

      expect((await patch(`/${report._id}/reopen`, { note: 'Mở lại' })).status).toBe(400);

      await patch(`/${report._id}/resolve`, { status: 'resolved', resolution: 'action_taken', adminNotes: VALID_NOTES });
      expect((await patch(`/${report._id}/reopen`, { note: 'Ngắn' })).status).toBe(400);

      const res = await patch(`/${report._id}/reopen`, { note: 'Người báo cáo gửi thêm bằng chứng mới' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reviewing');
      expect(res.body.data.resolution).toBeNull();
      expect(res.body.data.resolvedBy).toBeNull();
      expect(res.body.data.actions.map((action) => action.type)).toEqual(['warn']);
      expect(res.body.data.history.at(-1).eventType).toBe('reopen');
    });

    it('refuses a report that is not closed', async () => {
      const [reporter, reported] = await createPair();
      const report = await createReviewingReport(reporter, reported);
      const res = await patch(`/${report._id}/reopen`, { note: 'Người báo cáo gửi thêm bằng chứng' });
      expect(res.status).toBe(400);
    });
  });

  describe('severity mapping', () => {
    it('maps every category to a severity, child safety being critical', () => {
      Object.values(REPORT_CATEGORIES).forEach((category) => {
        expect(Object.values(REPORT_SEVERITY)).toContain(CATEGORY_TO_SEVERITY[category]);
      });
      expect(CATEGORY_TO_SEVERITY[REPORT_CATEGORIES.CHILD_SAFETY]).toBe(REPORT_SEVERITY.CRITICAL);
    });

    it('gives a new report the severity of its category', async () => {
      const [reporter, reported] = await createPair();
      const response = await safetyService.createReport(reporter.parent._id, {
        reportedUserId: reported.parent._id,
        category: REPORT_CATEGORIES.CHILD_SAFETY,
      });
      created.reports.push(response.id);

      expect((await Report.findById(response.id)).severity).toBe(REPORT_SEVERITY.CRITICAL);
    });

    it('migrates stored reports without a severity and leaves the others alone', async () => {
      const [reporter, reported] = await createPair();
      const base = {
        reporterId: reporter.parent._id,
        reportedUserId: reported.parent._id,
        targetType: REPORT_TARGET_TYPES.USER,
        status: REPORT_STATUS.PENDING,
        createdAt: new Date(),
      };
      const { insertedIds } = await Report.collection.insertMany([
        { ...base, category: REPORT_CATEGORIES.CHILD_SAFETY },
        { ...base, category: REPORT_CATEGORIES.SPAM },
        { ...base, category: REPORT_CATEGORIES.SPAM, severity: REPORT_SEVERITY.HIGH },
      ]);
      const [childSafety, spam, edited] = Object.values(insertedIds);
      created.reports.push(childSafety, spam, edited);

      await safetyService.backfillReportSeverities();
      await safetyService.backfillReportSeverities(); // Idempotent

      const stored = (id) => Report.collection.findOne({ _id: id });
      expect((await stored(childSafety)).severity).toBe(REPORT_SEVERITY.CRITICAL);
      expect((await stored(spam)).severity).toBe(REPORT_SEVERITY.LOW);
      expect((await stored(edited)).severity).toBe(REPORT_SEVERITY.HIGH);
      expect((await stored(childSafety)).actions).toEqual([]);
    });
  });

  describe('realtime broadcasts', () => {
    const createFakeIo = () => {
      const log = [];
      return {
        log,
        to: (room) => ({ emit: (event, payload) => log.push({ room, event, payload }) }),
        in: (room) => ({ disconnectSockets: (close) => log.push({ room, disconnect: close }) }),
      };
    };

    it('tells a locked account why, then closes its connections', () => {
      const io = createFakeIo();
      const notice = { reason: 'Tài khoản của bạn đã bị khóa vĩnh viễn.', suspensionUntil: null };

      broadcastAccountLocked(io, 'user-1', notice);

      expect(io.log).toEqual([
        { room: 'user:user-1', event: SOCKET_EVENTS.ACCOUNT_LOCKED, payload: notice },
        { room: 'user:user-1', disconnect: true },
      ]);
    });

    it('sends a deleted message to every participant', () => {
      const io = createFakeIo();

      broadcastMessageDeleted(io, {
        messageId: 'm1',
        conversationId: 'c1',
        content: DELETED_MESSAGE_PLACEHOLDER,
        participantIds: ['p1', 'p2'],
      });

      expect(io.log.map((entry) => entry.room)).toEqual(['parent:p1', 'parent:p2']);
      expect(io.log[0].event).toBe(SOCKET_EVENTS.MESSAGE_DELETED);
      expect(io.log[0].payload).toEqual({ messageId: 'm1', conversationId: 'c1', content: DELETED_MESSAGE_PLACEHOLDER });
    });

    it('does nothing in a process without the parent sockets', () => {
      expect(() => broadcastAccountLocked(null, 'user-1', {})).not.toThrow();
      expect(() => broadcastMessageDeleted(null, { participantIds: ['p1'] })).not.toThrow();
    });
  });
});
