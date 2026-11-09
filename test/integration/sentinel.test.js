import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Report from '../../src/modules/safety/report.model.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import Message from '../../src/modules/chat/message.model.js';
import safetyService from '../../src/modules/safety/safety.service.js';
import userService from '../../src/modules/user/user.service.js';
import chatService from '../../src/modules/chat/chat.service.js';
import { sentinelGeminiAdapter } from '../../src/integrations/ai/gemini.adapter.js';
import {
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  REPORT_STATUS,
  REPORT_TARGET_TYPES,
  REPORT_ACTION_TYPES,
} from '../../src/modules/safety/safety.constants.js';

const REPORTS_URL = '/api/v1/admin/reports';

describe('BuddyLink Sentinel AI Moderation Engine (/api/v1/admin/reports/sentinel)', () => {
  const password = 'AdminPassword123!';
  const runId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  let passwordHash = '';
  let parentCount = 0;
  let adminUser = null;
  let adminToken = '';

  const created = { users: [], parents: [], reports: [], conversations: [], messages: [] };

  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  const createParent = async (fullName) => {
    parentCount += 1;
    const user = await User.create({
      email: `sentinel-${runId}-${parentCount}@example.com`,
      passwordHash,
      role: 'parent',
      isActive: true,
    });
    const parent = await Parent.create({ userId: user._id, fullName });
    created.users.push(user._id);
    created.parents.push(parent._id);
    return { user, parent };
  };

  const createPair = async () => {
    const reporter = await createParent(`Reporter ${parentCount + 1}`);
    const reported = await createParent(`Reported ${parentCount + 2}`);
    return [reporter, reported];
  };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 10);
    adminUser = await User.create({
      email: `admin-sentinel-${runId}@example.com`,
      passwordHash,
      role: 'admin',
      isActive: true,
    });
    created.users.push(adminUser._id);

    const loginRes = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminUser.email, password });
    adminToken = loginRes.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await Report.deleteMany({ _id: { $in: created.reports } });
    await Message.deleteMany({ _id: { $in: created.messages } });
    await Conversation.deleteMany({ _id: { $in: created.conversations } });
    await Parent.deleteMany({ _id: { $in: created.parents } });
    await User.deleteMany({ _id: { $in: created.users } });
  });

  describe('AI Assessment & Auto-Resolve Safeguards', () => {
    it('successfully assesses a report and populates sentinelAssessment with system actor', async () => {
      const [reporter, reported] = await createPair();
      const report = await Report.create({
        reporterId: reporter.parent._id,
        reportedUserId: reported.parent._id,
        targetType: REPORT_TARGET_TYPES.USER,
        category: REPORT_CATEGORIES.SPAM,
        severity: REPORT_SEVERITY.LOW,
        reason: 'Quảng cáo sản phẩm đồ chơi',
        status: REPORT_STATUS.PENDING,
      });
      created.reports.push(report._id);

      const mockAiAssessment = {
        summary: 'Tài khoản gửi tin nhắn quảng cáo bán hàng hàng loạt',
        violationType: 'Thương mại spam',
        severity: 'low',
        confidenceScore: 92,
        evidenceAnalysis: { isValid: true, notes: 'Đã xác minh nội dung' },
        draftNotes: {
          adminNote: 'Xác nhận vi phạm spam mức độ nhẹ',
          reportedUserNotice: 'Vui lòng không gửi nội dung quảng cáo',
          reporterFeedback: 'Cảm ơn đã phản ánh',
        },
      };

      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockResolvedValueOnce({ text: JSON.stringify(mockAiAssessment) });

      const res = await asAdmin(
        request(adminApp).post(`${REPORTS_URL}/${report._id}/sentinel-assess`)
      );

      spy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.data.sentinelAssessment).toBeTruthy();
      expect(res.body.data.sentinelAssessment.confidenceScore).toBe(92);
      expect(res.body.data.sentinelAssessment.isFallback).toBe(false);
      expect(res.body.data.sentinelAssessment.policyClause).toContain('Rule 5.1');
    });

    it('freezes account via Auto-Shield on critical child safety, never auto-resolving', async () => {
      const [reporter, reported] = await createPair();
      const report = await Report.create({
        reporterId: reporter.parent._id,
        reportedUserId: reported.parent._id,
        targetType: REPORT_TARGET_TYPES.USER,
        category: REPORT_CATEGORIES.CHILD_SAFETY,
        severity: REPORT_SEVERITY.CRITICAL,
        reason: 'Hành vi dụ dỗ trẻ em',
        status: REPORT_STATUS.PENDING,
      });
      created.reports.push(report._id);

      const mockAiAssessment = {
        summary: 'Nghi vấn grooming và dụ dỗ trẻ em nghiêm trọng',
        violationType: 'Xâm hại an toàn trẻ em',
        severity: 'critical',
        confidenceScore: 95,
        evidenceAnalysis: { isValid: true, notes: 'Bằng chứng tin nhắn nguy hiểm' },
        draftNotes: { adminNote: 'Khẩn cấp: Tạm khóa 7 ngày chờ duyệt vĩnh viễn' },
      };

      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockResolvedValueOnce({ text: JSON.stringify(mockAiAssessment) });

      const res = await asAdmin(
        request(adminApp).post(`${REPORTS_URL}/${report._id}/sentinel-assess`)
      );

      spy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('reviewing'); // Must NOT be resolved!
      expect(res.body.data.sentinelAssessment.autoShieldApplied).toBe(true);
      expect(res.body.data.sentinelAssessment.autoResolved).toBe(false);
      expect(res.body.data.actions.some((a) => a.type === 'suspend' && a.isProvisional)).toBe(true);

      // Verify user messaging restriction is applied
      const updatedUser = await User.findById(reported.user._id);
      expect(updatedUser.messagingRestrictedUntil).toBeTruthy();
      expect(new Date(updatedUser.messagingRestrictedUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it('enforces messaging restriction in chat when user is restricted', async () => {
      const [userA, userB] = await createPair();

      // Restrict userA
      await userService.restrictMessaging(userA.user._id, new Date(Date.now() + 24 * 60 * 60 * 1000));

      const conversation = await Conversation.create({
        type: 'direct',
        participants: [userA.parent._id, userB.parent._id],
      });
      created.conversations.push(conversation._id);

      // Attempt to send message
      await expect(
        chatService.sendMessage(userA.user._id, conversation._id, {
          content: 'Hello, this should fail',
        })
      ).rejects.toThrow('Messaging is temporarily restricted');
    });

    it('ignores provisional and propagated actions when counting prior user strikes', async () => {
      const [reporter, reported] = await createPair();

      const mainReport = await Report.create({
        reporterId: reporter.parent._id,
        reportedUserId: reported.parent._id,
        targetType: REPORT_TARGET_TYPES.USER,
        category: REPORT_CATEGORIES.HARASSMENT,
        status: REPORT_STATUS.RESOLVED,
        actions: [
          {
            type: REPORT_ACTION_TYPES.WARN,
            note: 'Strike 1 confirmed by admin',
            performedBy: adminUser._id,
            actorType: 'admin',
            propagatedFrom: null,
            isProvisional: false,
          },
        ],
      });
      created.reports.push(mainReport._id);

      const relatedReport = await Report.create({
        reporterId: reporter.parent._id,
        reportedUserId: reported.parent._id,
        targetType: REPORT_TARGET_TYPES.USER,
        category: REPORT_CATEGORIES.HARASSMENT,
        status: REPORT_STATUS.RESOLVED,
        actions: [
          {
            type: REPORT_ACTION_TYPES.WARN,
            note: 'Copied action from mainReport',
            performedBy: adminUser._id,
            actorType: 'admin',
            propagatedFrom: mainReport._id, // Propagated copy!
            isProvisional: false,
          },
        ],
      });
      created.reports.push(relatedReport._id);

      const provisionalReport = await Report.create({
        reporterId: reporter.parent._id,
        reportedUserId: reported.parent._id,
        targetType: REPORT_TARGET_TYPES.USER,
        category: REPORT_CATEGORIES.SPAM,
        status: REPORT_STATUS.RESOLVED,
        actions: [
          {
            type: REPORT_ACTION_TYPES.SUSPEND,
            note: 'Auto shield provisional suspend',
            performedBy: null,
            actorType: 'system',
            propagatedFrom: null,
            isProvisional: true, // Provisional!
          },
        ],
      });
      created.reports.push(provisionalReport._id);

      const strikeCount = await safetyService.countUserPriorSanctions(reported.parent._id);
      // Only mainReport counts! The propagated copy and provisional action are excluded.
      expect(strikeCount).toBe(1);
    });
  });
});
