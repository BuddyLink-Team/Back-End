import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Report from '../../src/modules/safety/report.model.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import Message from '../../src/modules/chat/message.model.js';
import safetyService from '../../src/modules/safety/safety.service.js';
import userService from '../../src/modules/user/user.service.js';
import chatService from '../../src/modules/chat/chat.service.js';
import { sentinelGeminiAdapter } from '../../src/integrations/ai/gemini.adapter.js';
import sentinelService from '../../src/modules/safety/sentinel.service.js';
import AppError from '../../src/shared/exceptions/app-error.js';
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
        verdict: 'violation',
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
      expect(res.body.data.sentinelAssessment.policyClause).toContain('Điều 5.1');
    });

    const childSafetyAssessment = {
      summary: 'Nghi vấn grooming và dụ dỗ trẻ em nghiêm trọng',
      verdict: 'violation',
      violationType: 'Xâm hại an toàn trẻ em',
      severity: 'critical',
      confidenceScore: 95,
      evidenceAnalysis: { isValid: true, notes: 'Bằng chứng tin nhắn nguy hiểm' },
      draftNotes: { adminNote: 'Khẩn cấp: Tạm khóa 7 ngày chờ duyệt vĩnh viễn' },
    };

    const createChildSafetyReport = async () => {
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
      return { report, reported };
    };

    it('freezes account via Auto-Shield on a new critical child safety report, never auto-resolving', async () => {
      const { report, reported } = await createChildSafetyReport();
      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockResolvedValueOnce({ text: JSON.stringify(childSafetyAssessment), model: 'gemini-test' });

      // Same call as safetyService.createReport (background assessment of a new report)
      const doc = await Report.findById(report._id);
      await sentinelService.assessReport(doc, null, { allowAutoEnforce: true });
      spy.mockRestore();

      const res = await asAdmin(request(adminApp).get(`${REPORTS_URL}/${report._id}`));
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending'); // Must NOT be resolved!
      expect(res.body.data.sentinelAssessment.autoShieldApplied).toBe(true);
      expect(res.body.data.sentinelAssessment.autoResolved).toBe(false);
      expect(res.body.data.sentinelAssessment.assessedByModel).toBe('gemini-test');
      expect(res.body.data.sentinelAssessment.monitoring.temporaryRestriction.applied).toBe(true);
      expect(res.body.data.actions.some((a) => a.type === 'suspend' && a.isProvisional)).toBe(true);

      const updatedUser = await User.findById(reported.user._id);
      expect(updatedUser.messagingRestrictedUntil).toBeTruthy();
      expect(new Date(updatedUser.messagingRestrictedUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it('never enforces anything when the admin runs the assessment', async () => {
      const { report, reported } = await createChildSafetyReport();
      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockResolvedValueOnce({ text: JSON.stringify(childSafetyAssessment) });

      const res = await asAdmin(
        request(adminApp).post(`${REPORTS_URL}/${report._id}/sentinel-assess`).send({ forceRefresh: true })
      );
      spy.mockRestore();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.actions).toHaveLength(0);
      expect(res.body.data.sentinelAssessment.autoShieldApplied).toBe(false);
      expect(res.body.data.sentinelAssessment.monitoring.temporaryRestriction.applied).toBe(false);

      const updatedUser = await User.findById(reported.user._id);
      expect(updatedUser.messagingRestrictedUntil).toBeFalsy();
      expect(updatedUser.isActive).toBe(true);
    });

    it('falls back to a zero-confidence assessment when Gemini fails, without enforcing', async () => {
      const { report, reported } = await createChildSafetyReport();
      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockRejectedValueOnce(new AppError('AI request timed out', 503, 'AI_UNAVAILABLE'));

      const doc = await Report.findById(report._id);
      await sentinelService.assessReport(doc, null, { allowAutoEnforce: true });
      spy.mockRestore();

      const saved = await Report.findById(report._id).lean();
      expect(saved.sentinelAssessment.isFallback).toBe(true);
      expect(saved.sentinelAssessment.confidenceScore).toBe(0);
      expect(saved.sentinelAssessment.autoResolveEligible).toBe(false);
      expect(saved.sentinelAssessment.autoShieldApplied).toBe(false);
      expect(saved.status).toBe(REPORT_STATUS.PENDING);
      expect(saved.actions).toHaveLength(0);

      const updatedUser = await User.findById(reported.user._id);
      expect(updatedUser.messagingRestrictedUntil).toBeFalsy();
    });

    it('answers 503 SENTINEL_API_KEY_REQUIRED when the Sentinel key is missing', async () => {
      const { report } = await createChildSafetyReport();
      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockRejectedValueOnce(new AppError('Sentinel AI is not configured', 503, 'SENTINEL_API_KEY_REQUIRED'));

      const res = await asAdmin(request(adminApp).post(`${REPORTS_URL}/${report._id}/sentinel-assess`));
      spy.mockRestore();

      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).toContain('SENTINEL_API_KEY_REQUIRED');
    });

    it('does not restrict the target of suspected brigading (3 reporters, no evidence)', async () => {
      const reported = await createParent('Brigading target');
      const reports = [];
      for (let i = 0; i < 3; i += 1) {
        const reporter = await createParent(`Brigader ${i}`);
        const r = await Report.create({
          reporterId: reporter.parent._id,
          reportedUserId: reported.parent._id,
          targetType: REPORT_TARGET_TYPES.USER,
          category: REPORT_CATEGORIES.HARASSMENT,
          severity: REPORT_SEVERITY.MEDIUM,
          reason: 'Người này rất xấu tính',
          status: REPORT_STATUS.PENDING,
        });
        created.reports.push(r._id);
        reports.push(r);
      }

      const spy = jest.spyOn(sentinelGeminiAdapter, 'generateContent').mockResolvedValueOnce({
        text: JSON.stringify({ ...childSafetyAssessment, severity: 'high', confidenceScore: 95 }),
      });
      const doc = await Report.findById(reports[2]._id);
      await sentinelService.assessReport(doc, null, { allowAutoEnforce: true });
      spy.mockRestore();

      const saved = await Report.findById(reports[2]._id).lean();
      expect(saved.sentinelAssessment.monitoring.reporterCredibility.coordinatedSuspected).toBe(true);
      expect(saved.sentinelAssessment.monitoring.temporaryRestriction.applied).toBe(false);
      expect(saved.sentinelAssessment.autoResolved).toBe(false);
      expect(saved.actions).toHaveLength(0);

      const updatedUser = await User.findById(reported.user._id);
      expect(updatedUser.messagingRestrictedUntil).toBeFalsy();
    });

    it('batch scan only assesses, never sanctions or closes reports', async () => {
      const { report, reported } = await createChildSafetyReport();
      const spy = jest
        .spyOn(sentinelGeminiAdapter, 'generateContent')
        .mockResolvedValue({ text: JSON.stringify(childSafetyAssessment) });

      const res = await asAdmin(request(adminApp).post(`${REPORTS_URL}/sentinel-batch-scan`));
      spy.mockRestore();

      expect(res.status).toBe(200);
      const saved = await Report.findById(report._id).lean();
      expect(saved.status).toBe(REPORT_STATUS.PENDING);
      expect(saved.actions).toHaveLength(0);
      expect(Boolean(saved.sentinelAssessment?.autoShieldApplied)).toBe(false);

      const updatedUser = await User.findById(reported.user._id);
      expect(updatedUser.messagingRestrictedUntil).toBeFalsy();
      expect(updatedUser.isActive).toBe(true);
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

    describe('Corroboration: sanctions need several parents', () => {
      const noShowAssessment = {
        summary: 'Phụ huynh vắng mặt tại buổi hẹn đã xác nhận',
        verdict: 'violation',
        violationType: 'Vắng mặt không báo trước',
        severity: 'low',
        confidenceScore: 90,
        evidenceAnalysis: { isValid: true, notes: 'Buổi hẹn đã diễn ra' },
        draftNotes: { adminNote: 'Vắng mặt lặp lại' },
      };

      // A missing playdate stands for one already held: cancelling it is not applicable
      const createNoShowReports = async (reportedName, count) => {
        const reported = await createParent(reportedName);
        const reports = [];
        for (let i = 0; i < count; i += 1) {
          const reporter = await createParent(`${reportedName} reporter ${i}`);
          const r = await Report.create({
            reporterId: reporter.parent._id,
            reportedUserId: reported.parent._id,
            targetType: REPORT_TARGET_TYPES.PLAYDATE,
            targetPlaydateId: new mongoose.Types.ObjectId(),
            category: REPORT_CATEGORIES.NO_SHOW,
            severity: REPORT_SEVERITY.LOW,
            reason: 'Không đến buổi hẹn',
            status: REPORT_STATUS.PENDING,
          });
          created.reports.push(r._id);
          reports.push(r);
        }
        return { reported, reports };
      };

      const assessNew = async (report) => {
        const spy = jest
          .spyOn(sentinelGeminiAdapter, 'generateContent')
          .mockResolvedValueOnce({ text: JSON.stringify(noShowAssessment) });
        const doc = await Report.findById(report._id);
        await sentinelService.assessReport(doc, null, { allowAutoEnforce: true });
        spy.mockRestore();
        return Report.findById(report._id).lean();
      };

      it('never sanctions on a single report', async () => {
        const { reported, reports } = await createNoShowReports('Single no-show', 1);
        const saved = await assessNew(reports[0]);

        expect(saved.sentinelAssessment.corroboration.reporterCount).toBe(1);
        expect(saved.sentinelAssessment.corroboration.isCorroborated).toBe(false);
        expect(saved.sentinelAssessment.autoResolveEligible).toBe(false);
        expect(saved.status).toBe(REPORT_STATUS.PENDING);
        expect(saved.actions).toHaveLength(0);

        const user = await User.findById(reported.user._id).lean();
        expect(user.strikeCount || 0).toBe(0);
      });

      it('sanctions once for 3 parents, skips cancelling a held playdate and closes the group', async () => {
        const { reported, reports } = await createNoShowReports('Repeated no-show', 3);
        const saved = await assessNew(reports[2]);

        expect(saved.sentinelAssessment.corroboration).toMatchObject({ reporterCount: 3, isCorroborated: true });
        expect(saved.status).toBe(REPORT_STATUS.RESOLVED);
        expect(saved.sentinelAssessment.autoResolved).toBe(true);
        expect(saved.actions.map((a) => a.type)).toEqual([REPORT_ACTION_TYPES.WARN]);
        const closing = saved.history.find((h) => h.metadata?.autoResolved);
        expect(closing.metadata.notApplicable).toEqual([
          expect.objectContaining({ type: REPORT_ACTION_TYPES.CANCEL_PLAYDATE, reason: 'PLAYDATE_NOT_OPEN' }),
        ]);

        for (const other of reports.slice(0, 2)) {
          const related = await Report.findById(other._id).lean();
          expect(related.status).toBe(REPORT_STATUS.RESOLVED);
          expect(related.actions).toHaveLength(1);
          expect(String(related.actions[0].propagatedFrom)).toBe(String(reports[2]._id));
        }

        // One warning for the whole case, and one strike
        const user = await User.findById(reported.user._id).lean();
        expect(user.strikeCount).toBe(1);
        expect(await safetyService.countUserPriorSanctions(reported.parent._id)).toBe(1);

        // Each playdate is its own case: every closed report keeps a row of its own in the queue
        const closed = await Report.find({ _id: { $in: reports.map((r) => r._id) } }).lean();
        closed.forEach((r) => expect(String(r.closedCaseId)).toBe(String(r._id)));
      });

      it('sends the notices the AI wrote when it closes a case itself', async () => {
        const { reported, reports } = await createNoShowReports('Drafted no-show', 3);
        const offender = 'Bạn đã vắng mặt nhiều buổi hẹn mà không báo trước, tài khoản nhận một cảnh cáo.';
        const reporterText = 'Cảm ơn bạn, chúng tôi đã cảnh cáo phụ huynh vắng mặt.';
        const spy = jest.spyOn(sentinelGeminiAdapter, 'generateContent').mockResolvedValueOnce({
          text: JSON.stringify({
            ...noShowAssessment,
            draftNotes: { adminNote: 'Vắng mặt lặp lại', reportedUserNotice: offender, reporterFeedback: reporterText },
          }),
        });
        await sentinelService.assessReport(await Report.findById(reports[2]._id), null, { allowAutoEnforce: true });
        spy.mockRestore();

        const offenderNotices = await Notification.find({ recipientId: reported.user._id }).lean();
        expect(offenderNotices.map((n) => n.body)).toEqual([offender]);
        for (const report of reports) {
          const reporter = await Parent.findById(report.reporterId).lean();
          const [notice] = await Notification.find({ recipientId: reporter.userId }).lean();
          expect(notice.body).toBe(reporterText);
        }
      });

      it('runs no sanction at all when one of them cannot run (reported account missing)', async () => {
        const { reported, reports } = await createNoShowReports('Deleted no-show', 3);
        await User.deleteOne({ _id: reported.user._id });
        const saved = await assessNew(reports[2]);

        expect(saved.status).toBe(REPORT_STATUS.PENDING);
        expect(saved.actions).toHaveLength(0);
        expect(saved.history.some((h) => h.eventType === 'action_failed')).toBe(true);
        for (const other of reports.slice(0, 2)) {
          const related = await Report.findById(other._id).lean();
          expect(related.status).toBe(REPORT_STATUS.PENDING);
        }
      });

      describe('Quick cluster handling from the overview', () => {
        const CLUSTER_URL = `${REPORTS_URL}/sentinel-cluster-resolve`;
        // Assessed without enforcement (as the batch scan does), with a given verdict
        const assessOnly = async (report, verdict) => {
          const spy = jest
            .spyOn(sentinelGeminiAdapter, 'generateContent')
            .mockResolvedValueOnce({ text: JSON.stringify({ ...noShowAssessment, verdict }) });
          const doc = await Report.findById(report._id);
          await sentinelService.assessReport(doc, null, {});
          spy.mockRestore();
        };

        it('sanctions once, closes the violations together, dismisses the false ones, keeps the unclear', async () => {
          const { reported, reports } = await createNoShowReports('Cluster', 5);
          const verdicts = ['violation', 'violation', 'violation', 'no_violation', 'unclear'];
          for (let i = 0; i < reports.length; i += 1) await assessOnly(reports[i], verdicts[i]);

          const res = await asAdmin(
            request(adminApp)
              .post(CLUSTER_URL)
              .send({ reportIds: reports.map((r) => r._id.toString()), note: 'Xử lý nhanh cụm vắng mặt' })
          );
          expect(res.status).toBe(200);
          const result = res.body.data;
          expect(result.applied).toEqual([REPORT_ACTION_TYPES.WARN]);
          expect(result.resolved).toHaveLength(3);
          expect(result.dismissed).toEqual([reports[3]._id.toString()]);
          expect(result.skipped).toEqual([expect.objectContaining({ id: reports[4]._id.toString() })]);

          const saved = await Report.find({ _id: { $in: reports.map((r) => r._id) } }).lean();
          const byId = new Map(saved.map((r) => [String(r._id), r]));
          const primary = byId.get(result.sanctionedReportId);
          expect(primary.resolution).toBe('action_taken');
          for (const id of result.resolved.filter((rid) => rid !== result.sanctionedReportId)) {
            const other = byId.get(id);
            expect(other.status).toBe(REPORT_STATUS.RESOLVED);
            expect(other.resolution).toBe('action_taken');
            expect(String(other.actions[0].propagatedFrom)).toBe(result.sanctionedReportId);
          }
          expect(byId.get(reports[3]._id.toString()).status).toBe(REPORT_STATUS.DISMISSED);
          expect(byId.get(reports[4]._id.toString()).status).toBe(REPORT_STATUS.PENDING);

          // One warning for the whole cluster, one strike
          const user = await User.findById(reported.user._id).lean();
          expect(user.strikeCount).toBe(1);
          expect(await safetyService.countUserPriorSanctions(reported.parent._id)).toBe(1);
        });

        it('refuses a cluster mixing several reported parents', async () => {
          const first = await createNoShowReports('Mixed A', 1);
          const second = await createNoShowReports('Mixed B', 1);

          const res = await asAdmin(
            request(adminApp)
              .post(CLUSTER_URL)
              .send({ reportIds: [first.reports[0]._id.toString(), second.reports[0]._id.toString()] })
          );
          expect(res.status).toBe(400);
          expect(JSON.stringify(res.body)).toContain('CLUSTER_MIXED_USERS');
        });
      });

      describe('AI verdict', () => {
        const assessWith = async (report, verdict) => {
          const spy = jest
            .spyOn(sentinelGeminiAdapter, 'generateContent')
            .mockResolvedValueOnce({ text: JSON.stringify({ ...noShowAssessment, verdict }) });
          const doc = await Report.findById(report._id);
          await sentinelService.assessReport(doc, null, { allowAutoEnforce: true });
          spy.mockRestore();
          return Report.findById(report._id).lean();
        };

        it('recommends no sanction and never enforces when the AI finds no violation', async () => {
          const { reports } = await createNoShowReports('No violation', 3);
          const saved = await assessWith(reports[2], 'no_violation');

          expect(saved.sentinelAssessment.verdict).toBe('no_violation');
          expect(saved.sentinelAssessment.recommendedSanctions).toEqual([]);
          expect(saved.sentinelAssessment.autoResolveEligible).toBe(false);
          expect(saved.status).toBe(REPORT_STATUS.PENDING);
          expect(saved.actions).toHaveLength(0);

          // The policy panel still shows the matrix; the AI recommendation stays empty
          const url = `${REPORTS_URL}/${reports[2]._id}`;
          const detail = await asAdmin(request(adminApp).get(url));
          expect(detail.body.data.policyGuidance.standardActions.length).toBeGreaterThan(0);
          expect(detail.body.data.sentinelAssessment.recommendedSanctions).toEqual([]);

          await asAdmin(request(adminApp).patch(`${url}/review`).send({ action: 'claim' }));
          const applied = await asAdmin(request(adminApp).post(`${url}/sentinel-apply`).send({}));
          expect(applied.body.data.sentinelApplyResult.applied).toEqual([]);
          expect(applied.body.data.actions).toHaveLength(0);
        });

        it('treats a missing or unknown verdict as unclear: no AI recommendation', async () => {
          const { reports } = await createNoShowReports('Unclear verdict', 1);
          const saved = await assessWith(reports[0], 'maybe');

          expect(saved.sentinelAssessment.verdict).toBe('unclear');
          expect(saved.sentinelAssessment.recommendedSanctions).toEqual([]);
        });
      });

      describe('Rule numbers stay in sync with the data of now', () => {
        const addNoShowReports = async (reported, count, prefix) => {
          const reports = [];
          for (let i = 0; i < count; i += 1) {
            const reporter = await createParent(`${prefix} ${i}`);
            const r = await Report.create({
              reporterId: reporter.parent._id,
              reportedUserId: reported.parent._id,
              targetType: REPORT_TARGET_TYPES.PLAYDATE,
              targetPlaydateId: new mongoose.Types.ObjectId(),
              category: REPORT_CATEGORIES.NO_SHOW,
              severity: REPORT_SEVERITY.LOW,
              reason: 'Không đến buổi hẹn',
              status: REPORT_STATUS.PENDING,
            });
            created.reports.push(r._id);
            reports.push(r);
          }
          return reports;
        };

        it('recomputes corroboration in the detail when reports are filed after the assessment', async () => {
          const { reported, reports } = await createNoShowReports('Late corroboration', 1);
          const assessed = await assessNew(reports[0]);
          expect(assessed.sentinelAssessment.corroboration.reporterCount).toBe(1);

          await addNoShowReports(reported, 2, 'Late reporter');

          const res = await asAdmin(request(adminApp).get(`${REPORTS_URL}/${reports[0]._id}`));
          expect(res.status).toBe(200);
          expect(res.body.data.sentinelAssessment.corroboration).toMatchObject({
            reporterCount: 3,
            isCorroborated: true,
          });
          expect(res.body.data.sentinelAssessment.newReportsSinceAssessment).toBe(2);
          // The AI text is kept from its assessment
          expect(res.body.data.sentinelAssessment.summary).toBe(assessed.sentinelAssessment.summary);

          // Reading never writes; the refresh saves the numbers for lists and overviews
          const beforeRefresh = await Report.findById(reports[0]._id).lean();
          expect(beforeRefresh.sentinelAssessment.corroboration.reporterCount).toBe(1);
          await sentinelService.refreshRuleSnapshots(reported.parent._id);
          const afterRefresh = await Report.findById(reports[0]._id).lean();
          expect(afterRefresh.sentinelAssessment.corroboration.reporterCount).toBe(3);
        });

        it('shows one recommendation, following a severity change, in the AI card and the policy panel', async () => {
          const { reports } = await createNoShowReports('Severity change', 1);
          await assessNew(reports[0]);
          const url = `${REPORTS_URL}/${reports[0]._id}`;

          await asAdmin(request(adminApp).patch(`${url}/review`).send({ action: 'claim' }));
          const res = await asAdmin(request(adminApp).patch(`${url}/severity`).send({ severity: 'critical' }));
          expect(res.status).toBe(200);

          const { sentinelAssessment, policyGuidance } = res.body.data;
          expect(policyGuidance.clause).toContain('Điều 0.1');
          expect(sentinelAssessment.policyClause).toBe(policyGuidance.clause);
          expect(sentinelAssessment.recommendedSanctions).toEqual(policyGuidance.standardActions);

          const saved = await Report.findById(reports[0]._id).lean();
          expect(saved.sentinelAssessment.policyClause).toContain('Điều 0.1');
        });

        it('applies only the missing recommended sanctions and leaves the report open', async () => {
          const { reports } = await createNoShowReports('Apply only', 1);
          await assessNew(reports[0]);
          const url = `${REPORTS_URL}/${reports[0]._id}`;

          const first = await asAdmin(request(adminApp).post(`${url}/sentinel-apply`).send({ note: 'Đồng ý theo AI' }));
          expect(first.status).toBe(200);
          expect(first.body.data.status).toBe(REPORT_STATUS.PENDING);
          expect(first.body.data.sentinelApplyResult.applied).toEqual([REPORT_ACTION_TYPES.WARN]);
          expect(first.body.data.sentinelApplyResult.notApplicable).toEqual([
            expect.objectContaining({ type: REPORT_ACTION_TYPES.CANCEL_PLAYDATE }),
          ]);

          // A second click never sanctions twice
          const second = await asAdmin(request(adminApp).post(`${url}/sentinel-apply`).send({}));
          expect(second.body.data.sentinelApplyResult.applied).toEqual([]);
          const saved = await Report.findById(reports[0]._id).lean();
          expect(saved.actions.filter((a) => a.type === REPORT_ACTION_TYPES.WARN)).toHaveLength(1);
          expect(saved.status).toBe(REPORT_STATUS.PENDING);
        });

        it('keeps what was decided on a closed report', async () => {
          const { reported, reports } = await createNoShowReports('Closed snapshot', 1);
          await assessNew(reports[0]);
          await Report.updateOne({ _id: reports[0]._id }, { status: REPORT_STATUS.DISMISSED, resolution: 'dismissed' });
          await addNoShowReports(reported, 2, 'After closing');

          const res = await asAdmin(request(adminApp).get(`${REPORTS_URL}/${reports[0]._id}`));
          expect(res.body.data.sentinelAssessment.corroboration.reporterCount).toBe(1);
          expect(res.body.data.sentinelAssessment.newReportsSinceAssessment).toBeUndefined();
        });
      });
    });

    describe('Conclusion matches the sanctions', () => {
      const reviewingWith = async (actions) => {
        const [reporter, reported] = await createPair();
        const report = await Report.create({
          reporterId: reporter.parent._id,
          reportedUserId: reported.parent._id,
          targetType: REPORT_TARGET_TYPES.USER,
          category: REPORT_CATEGORIES.SPAM,
          severity: REPORT_SEVERITY.LOW,
          reason: 'Quảng cáo',
          status: REPORT_STATUS.REVIEWING,
          actions,
        });
        created.reports.push(report._id);
        return `${REPORTS_URL}/${report._id}/resolve`;
      };
      const warn = { type: REPORT_ACTION_TYPES.WARN, actorType: 'admin', performedBy: null };
      const NOTES = 'Đã xác minh nội dung báo cáo.';

      it('only accepts action_taken once an official sanction was applied', async () => {
        const url = await reviewingWith([warn]);

        const noAction = await asAdmin(request(adminApp).patch(url).send({ status: 'resolved', resolution: 'no_action', adminNotes: NOTES }));
        expect(noAction.status).toBe(400);
        expect(JSON.stringify(noAction.body)).toContain('RESOLUTION_CONFLICTS_WITH_ACTIONS');

        const dismissed = await asAdmin(request(adminApp).patch(url).send({ status: 'dismissed', resolution: 'dismissed', adminNotes: NOTES }));
        expect(dismissed.status).toBe(400);

        const done = await asAdmin(request(adminApp).patch(url).send({ status: 'resolved', resolution: 'action_taken', adminNotes: NOTES }));
        expect(done.status).toBe(200);
      });

      it('does not count a provisional Auto-Shield action as a decision', async () => {
        const url = await reviewingWith([{ ...warn, actorType: 'system', isProvisional: true }]);

        const actionTaken = await asAdmin(request(adminApp).patch(url).send({ status: 'resolved', resolution: 'action_taken', adminNotes: NOTES }));
        expect(actionTaken.status).toBe(400);
        expect(JSON.stringify(actionTaken.body)).toContain('ACTIONS_REQUIRED_FOR_RESOLVE');

        const noAction = await asAdmin(request(adminApp).patch(url).send({ status: 'resolved', resolution: 'no_action', adminNotes: NOTES }));
        expect(noAction.status).toBe(200);
      });
    });

    it('counts reports about the same playdate as one strike', async () => {
      const [reporterA, reported] = await createPair();
      const reporterB = await createParent('Same playdate B');
      const playdateId = new mongoose.Types.ObjectId();
      const sanctioned = (reporter) =>
        Report.create({
          reporterId: reporter.parent._id,
          reportedUserId: reported.parent._id,
          targetType: REPORT_TARGET_TYPES.PLAYDATE,
          targetPlaydateId: playdateId,
          category: REPORT_CATEGORIES.NO_SHOW,
          status: REPORT_STATUS.RESOLVED,
          actions: [{ type: REPORT_ACTION_TYPES.WARN, actorType: 'admin', performedBy: adminUser._id }],
        });
      const first = await sanctioned(reporterA);
      const second = await sanctioned(reporterB);
      created.reports.push(first._id, second._id);

      expect(await safetyService.countUserPriorSanctions(reported.parent._id)).toBe(1);
      // The incident being handled is never its own prior strike
      expect(await safetyService.countUserPriorSanctions(reported.parent._id, second)).toBe(0);
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
