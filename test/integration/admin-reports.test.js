import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import adminApp from '../../src/admin-app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Report from '../../src/modules/safety/report.model.js';
import {
  REPORT_STATUS,
  REPORT_SEVERITY,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  REPORT_ACTION_TYPES,
  REPORT_RESOLUTION_TYPES,
} from '../../src/modules/safety/safety.constants.js';

describe('Admin Safety & Reports Moderation (/api/v1/admin/reports)', () => {
  const password = 'AdminPassword123!';
  const timestamp = Date.now();
  const adminEmail = `admin-report-${timestamp}@buddylink.com`;
  const reporterEmail = `reporter-${timestamp}@example.com`;
  const reportedEmail = `reported-${timestamp}@example.com`;

  let adminTokens = null;
  let parentToken = '';
  let adminUser = null;
  let reporterParent = null;
  let reportedParent = null;
  let testReport = null;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    adminUser = await User.create({
      email: adminEmail,
      passwordHash,
      role: 'admin',
      isActive: true,
    });

    const adminLogin = await request(adminApp)
      .post('/api/v1/admin/auth/login')
      .send({ email: adminEmail, password });
    adminTokens = adminLogin.body.data.tokens;

    // Create reporter parent
    const reporterUser = await User.create({
      email: reporterEmail,
      passwordHash,
      role: 'parent',
      isActive: true,
    });
    reporterParent = await Parent.create({
      userId: reporterUser._id,
      fullName: 'Reporter Mom',
    });

    // Create reported parent
    const reportedUser = await User.create({
      email: reportedEmail,
      passwordHash,
      role: 'parent',
      isActive: true,
      strikeCount: 0,
    });
    reportedParent = await Parent.create({
      userId: reportedUser._id,
      fullName: 'Reported Dad',
    });

    // Create test report
    testReport = await Report.create({
      reporterId: reporterParent._id,
      reportedUserId: reportedParent._id,
      targetType: REPORT_TARGET_TYPES.USER,
      category: REPORT_CATEGORIES.HARASSMENT,
      severity: REPORT_SEVERITY.HIGH,
      reason: 'Quấy rối qua tin nhắn',
      description: 'Người này liên tục gửi tin nhắn gây phiền hà',
      status: REPORT_STATUS.PENDING,
      actions: [],
      history: [],
    });
  });

  afterAll(async () => {
    if (adminUser) await User.deleteOne({ _id: adminUser._id });
    if (reporterParent) {
      await User.deleteOne({ _id: reporterParent.userId });
      await Parent.deleteOne({ _id: reporterParent._id });
    }
    if (reportedParent) {
      await User.deleteOne({ _id: reportedParent.userId });
      await Parent.deleteOne({ _id: reportedParent._id });
    }
    if (testReport) await Report.deleteOne({ _id: testReport._id });
  });

  it('TC-BE-01: Admin token can access /reports, unauthorized token receives 401/403', async () => {
    const unauthRes = await request(adminApp).get('/api/v1/admin/reports');
    expect(unauthRes.status).toBe(401);

    const okRes = await request(adminApp)
      .get('/api/v1/admin/reports')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);
    expect(okRes.status).toBe(200);
    expect(Array.isArray(okRes.body.data.items)).toBe(true);
  });

  it('TC-BE-02: GET /reports/stats returns queue stats and SLA metrics', async () => {
    const res = await request(adminApp)
      .get('/api/v1/admin/reports/stats')
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('pending');
    expect(res.body.data).toHaveProperty('reviewing');
    expect(res.body.data).toHaveProperty('overdue');
    expect(res.body.data).toHaveProperty('avgResolutionHours');
  });

  it('TC-BE-03: GET /reports/:id returns detailed report with investigation context', async () => {
    const res = await request(adminApp)
      .get(`/api/v1/admin/reports/${testReport._id}`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(testReport._id.toString());
    expect(res.body.data.reporter.fullName).toBe('Reporter Mom');
    expect(res.body.data.reportedUser.fullName).toBe('Reported Dad');
  });

  it('TC-BE-04: PATCH /reports/:id/review claims the report and transitions to reviewing', async () => {
    const res = await request(adminApp)
      .patch(`/api/v1/admin/reports/${testReport._id}/review`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ action: 'claim' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('reviewing');
    expect(res.body.data.assignedTo.id).toBe(adminUser._id.toString());
  });

  it('TC-BE-05: PATCH /reports/:id/severity updates severity during reviewing', async () => {
    const res = await request(adminApp)
      .patch(`/api/v1/admin/reports/${testReport._id}/severity`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ severity: 'critical', note: 'Phát hiện tính chất đe dọa nghiêm trọng' });

    expect(res.status).toBe(200);
    expect(res.body.data.severity).toBe('critical');
  });

  it('TC-BE-06: POST /reports/:id/action applies warn action, and prevents duplicate', async () => {
    const res = await request(adminApp)
      .post(`/api/v1/admin/reports/${testReport._id}/action`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ type: 'warn', note: 'Cảnh cáo lần 1 về hành vi quấy rối' });

    expect(res.status).toBe(200);
    expect(res.body.data.actions.some((a) => a.type === 'warn')).toBe(true);

    // Duplicate action should return 409
    const dupRes = await request(adminApp)
      .post(`/api/v1/admin/reports/${testReport._id}/action`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ type: 'warn', note: 'Cảnh cáo lần 2' });

    expect(dupRes.status).toBe(409);
  });

  it('TC-BE-07: PATCH /reports/:id/resolve validates notes length and resolves report', async () => {
    // Too short note (< 10 chars)
    const shortRes = await request(adminApp)
      .patch(`/api/v1/admin/reports/${testReport._id}/resolve`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        status: 'resolved',
        resolution: 'action_taken',
        adminNotes: 'Ngắn',
      });
    expect(shortRes.status).toBe(400);

    // Valid resolve
    const validRes = await request(adminApp)
      .patch(`/api/v1/admin/reports/${testReport._id}/resolve`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({
        status: 'resolved',
        resolution: 'action_taken',
        adminNotes: 'Đã tiến hành cảnh cáo phụ huynh vi phạm và giải thích quy định.',
      });

    expect(validRes.status).toBe(200);
    expect(validRes.body.data.status).toBe('resolved');
    expect(validRes.body.data.resolution).toBe('action_taken');
  });

  it('TC-BE-08: PATCH /reports/:id/reopen reopens closed report without rolling back actions', async () => {
    const res = await request(adminApp)
      .patch(`/api/v1/admin/reports/${testReport._id}/reopen`)
      .set('Authorization', `Bearer ${adminTokens.accessToken}`)
      .send({ note: 'Người báo cáo cung cấp thêm ảnh chụp màn hình mới' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('reviewing');
    expect(res.body.data.actions.some((a) => a.type === 'warn')).toBe(true);
  });
});
