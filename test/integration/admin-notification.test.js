import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import env from '../../src/config/env.js';
import { authenticateAdminSocket } from '../../src/config/socket.js';
import { registerAdminNotificationListeners } from '../../src/modules/admin/admin-notification.listener.js';
import adminNotificationService from '../../src/modules/admin/admin-notification.service.js';
import AdminNotification from '../../src/modules/admin/admin-notification.model.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import { TOKEN_AUDIENCES } from '../../src/modules/auth/auth.constants.js';
import { emitUserEvent, USER_EVENTS } from '../../src/modules/user/user.events.js';
import { emitSubscriptionEvent, SUBSCRIPTION_EVENTS } from '../../src/modules/subscription/subscription.events.js';
import { emitPlaydateEvent, PLAYDATE_EVENTS } from '../../src/modules/playdate/playdate.events.js';
import { emitConnectionEvent, CONNECTION_EVENTS } from '../../src/modules/connection/connection.events.js';
import { emitSafetyEvent, SAFETY_EVENTS } from '../../src/modules/safety/safety.events.js';
import { emitSystemEvent, SYSTEM_EVENTS } from '../../src/shared/events/system.events.js';

const newId = () => new mongoose.Types.ObjectId();

// Suites share one database: each row is found through the entity id of its event
const findByEntity = (entityId) => AdminNotification.findOne({ entityId }).lean();

describe('Admin notification listeners', () => {
  beforeAll(() => {
    registerAdminNotificationListeners();
  });

  it.each([
    ['locked', false, 'account_locked', 'warning'],
    ['unlocked', true, 'account_unlocked', 'info'],
  ])('account %s', async (_label, isActive, type, severity) => {
    const userId = newId();
    await emitUserEvent(USER_EVENTS.USER_STATUS_CHANGED, { userId, email: 'a@example.com', isActive });

    expect(await findByEntity(userId)).toMatchObject({ category: 'users', type, severity, entityType: 'User' });
  });

  it('new sign-up', async () => {
    const userId = newId();
    await emitUserEvent(USER_EVENTS.USER_SIGNED_UP, { userId, email: 'a@example.com', fullName: 'Nguyễn An' });

    const row = await findByEntity(userId);
    expect(row).toMatchObject({ category: 'users', type: 'new_signup', severity: 'info' });
    expect(row.message).toContain('Nguyễn An');
  });

  it.each([
    [SUBSCRIPTION_EVENTS.PAYMENT_SUCCEEDED, 'payment_succeeded', 'info'],
    [SUBSCRIPTION_EVENTS.PAYMENT_FAILED, 'payment_failed', 'warning'],
  ])('%s', async (event, type, severity) => {
    const paymentId = newId();
    await emitSubscriptionEvent(event, { paymentId: paymentId.toString(), orderCode: 123456, amount: 99000 });

    expect(await findByEntity(paymentId)).toMatchObject({ category: 'payments', type, severity, entityType: 'Payment' });
  });

  it('new subscription', async () => {
    const subscriptionId = newId();
    await emitSubscriptionEvent(SUBSCRIPTION_EVENTS.SUBSCRIPTION_CREATED, {
      subscriptionId: subscriptionId.toString(),
      planName: 'Premium Tháng',
    });

    expect(await findByEntity(subscriptionId)).toMatchObject({ category: 'payments', type: 'new_subscription' });
  });

  it('expired subscription names the parent', async () => {
    const stamp = Date.now();
    const user = await User.create({ email: `expired-${stamp}@example.com`, passwordHash: 'x', role: 'parent' });
    const parent = await Parent.create({ userId: user._id, fullName: 'Trần Bình' });
    const subscriptionId = newId();

    await emitSubscriptionEvent(SUBSCRIPTION_EVENTS.SUBSCRIPTION_EXPIRED, {
      subscriptionId: subscriptionId.toString(),
      planCode: 'premium_monthly',
      parentId: parent._id.toString(),
    });

    const row = await findByEntity(subscriptionId);
    expect(row).toMatchObject({ category: 'payments', type: 'subscription_expired' });
    expect(row.message).toContain('Trần Bình');
  });

  it.each([
    ['by a parent', false, 'info'],
    ['by an admin', true, 'warning'],
  ])('playdate cancelled %s', async (_label, cancelledByAdmin, severity) => {
    const playdateId = newId();
    await emitPlaydateEvent(PLAYDATE_EVENTS.CANCELLED, {
      playdateId: playdateId.toString(),
      activity: 'Dã ngoại',
      cancelledByAdmin,
      reason: 'Trời mưa',
    });

    const row = await findByEntity(playdateId);
    expect(row).toMatchObject({ category: 'playdates', type: 'cancelled', severity });
    expect(row.message).toContain('Trời mưa');
  });

  it('playdate created', async () => {
    const playdateId = newId();
    await emitPlaydateEvent(PLAYDATE_EVENTS.CREATED, { playdateId: playdateId.toString(), activity: 'Dã ngoại', hostName: 'An' });

    expect(await findByEntity(playdateId)).toMatchObject({ category: 'playdates', type: 'created' });
  });

  it.each([
    [CONNECTION_EVENTS.ACCEPTED, 'new_connection'],
    [CONNECTION_EVENTS.REMOVED, 'connection_removed'],
  ])('%s', async (event, type) => {
    const connectionId = newId();
    await emitConnectionEvent(event, { connectionId: connectionId.toString() });

    expect(await findByEntity(connectionId)).toMatchObject({ category: 'connections', type, entityType: 'Connection' });
  });

  it('violation report is critical', async () => {
    const reportId = newId();
    await emitSafetyEvent(SAFETY_EVENTS.REPORT_CREATED, { reportId: reportId.toString(), reason: 'Spam' });

    expect(await findByEntity(reportId)).toMatchObject({ category: 'safety', severity: 'critical', entityType: 'Report' });
  });

  it('cron failure is critical', async () => {
    const jobName = `Job-${Date.now()}`;
    await emitSystemEvent(SYSTEM_EVENTS.CRON_JOB_FAILED, { jobName, error: 'boom' });

    const row = await AdminNotification.findOne({ type: 'cron_job_failed', message: { $regex: jobName } }).lean();
    expect(row).toMatchObject({ category: 'system', severity: 'critical' });
  });

  describe('PayOS webhook errors', () => {
    beforeEach(async () => {
      await AdminNotification.deleteMany({ type: 'payment_gateway_error' });
    });

    it('creates one notification however many times the webhook fails', async () => {
      await emitSystemEvent(SYSTEM_EVENTS.PAYMENT_GATEWAY_ERROR, { error: 'Invalid signature' });
      await emitSystemEvent(SYSTEM_EVENTS.PAYMENT_GATEWAY_ERROR, { error: 'Invalid signature' });
      await emitSystemEvent(SYSTEM_EVENTS.PAYMENT_GATEWAY_ERROR, { error: 'Invalid signature' });

      expect(await AdminNotification.countDocuments({ type: 'payment_gateway_error' })).toBe(1);
    });

    it('creates a new one once the window has passed', async () => {
      await AdminNotification.create({
        category: 'system',
        type: 'payment_gateway_error',
        severity: 'critical',
        title: 'Old',
        message: 'Old',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      await emitSystemEvent(SYSTEM_EVENTS.PAYMENT_GATEWAY_ERROR, { error: 'Invalid signature' });

      expect(await AdminNotification.countDocuments({ type: 'payment_gateway_error' })).toBe(2);
    });
  });

  it('a notification that cannot be saved does not reach the emitter', async () => {
    await expect(
      adminNotificationService.createNotification({ category: 'not-a-category', type: 'x', title: 'x', message: 'x' })
    ).rejects.toThrow();

    await expect(
      emitUserEvent(USER_EVENTS.USER_STATUS_CHANGED, { userId: 'not-an-object-id', email: 'a@example.com', isActive: true })
    ).resolves.toBeUndefined();
  });
});

describe('Socket /admin namespace authentication', () => {
  const sign = (user, audience) =>
    jwt.sign({ sub: user._id.toString(), role: user.role, aud: audience }, env.JWT.SECRET, { expiresIn: '5m' });

  const authenticate = async (token) => {
    const socket = { handshake: { auth: { token } } };
    const error = await new Promise((resolve) => {
      authenticateAdminSocket(socket, resolve);
    });
    return { socket, error };
  };

  let admin = null;
  let parent = null;

  beforeAll(async () => {
    const stamp = Date.now();
    admin = await User.create({ email: `socket-admin-${stamp}@buddylink.com`, passwordHash: 'x', role: 'admin' });
    parent = await User.create({ email: `socket-parent-${stamp}@example.com`, passwordHash: 'x', role: 'parent' });
  });

  it('accepts an admin token', async () => {
    const { socket, error } = await authenticate(sign(admin, TOKEN_AUDIENCES.ADMIN));

    expect(error).toBeUndefined();
    expect(socket.userId).toBe(admin._id.toString());
  });

  it('rejects a parent token', async () => {
    const { error } = await authenticate(sign(parent, TOKEN_AUDIENCES.APP));

    expect(error).toBeInstanceOf(Error);
  });

  it('rejects an admin audience on a parent account', async () => {
    const { error } = await authenticate(sign(parent, TOKEN_AUDIENCES.ADMIN));

    expect(error.message).toContain('Admin access required');
  });

  it('rejects a missing or forged token', async () => {
    const missing = await authenticate(undefined);
    const forged = await authenticate(jwt.sign({ sub: admin._id.toString(), aud: TOKEN_AUDIENCES.ADMIN }, 'other-secret'));

    expect(missing.error).toBeInstanceOf(Error);
    expect(forged.error).toBeInstanceOf(Error);
  });

  it('rejects a locked admin', async () => {
    const locked = await User.create({
      email: `socket-locked-${Date.now()}@buddylink.com`,
      passwordHash: 'x',
      role: 'admin',
      isActive: false,
    });

    const { error } = await authenticate(sign(locked, TOKEN_AUDIENCES.ADMIN));

    expect(error).toBeInstanceOf(Error);
  });
});
