import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import notificationService from '../../src/modules/notification/notification.service.js';
import { NOTIFICATION_TYPES } from '../../src/modules/notification/notification.constants.js';

const register = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `User ${label}`,
    email: `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    password: 'Password123!',
  });
  return {
    token: res.body.data.tokens.accessToken,
    userId: res.body.data.user.id,
    parentId: res.body.data.parent.id,
  };
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('Notifications module API (/api/v1/notifications)', () => {
  let userA;
  let userB;

  beforeAll(async () => {
    [userA, userB] = await Promise.all([register('notifyA'), register('notifyB')]);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('returns empty list and 0 unreadCount initially', async () => {
    const res = await request(app).get('/api/v1/notifications').set(auth(userA.token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.unreadCount).toBe(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('creates and lists notifications for a user', async () => {
    await notificationService.createNotification({
      recipientId: userA.userId,
      type: NOTIFICATION_TYPES.CONNECTION_REQUEST,
      title: 'Lời mời kết nối mới',
      body: 'User B đã gửi cho bạn lời mời kết nối',
      data: { senderId: userB.parentId },
    });

    await notificationService.createNotification({
      recipientId: userA.userId,
      type: NOTIFICATION_TYPES.BADGE_UNLOCKED,
      title: 'Huy hiệu mới!',
      body: 'Bạn đã mở khóa huy hiệu Người kết nối',
      data: { badgeCode: 'SUPER_CONNECTOR' },
    });

    const res = await request(app).get('/api/v1/notifications').set(auth(userA.token));
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.unreadCount).toBe(2);
    expect(res.body.data.items[0].isRead).toBe(false);

    // Check sender info populated
    const connNotif = res.body.data.items.find((n) => n.type === NOTIFICATION_TYPES.CONNECTION_REQUEST);
    expect(connNotif).toBeDefined();
    expect(connNotif.data.sender).toBeDefined();
    expect(connNotif.data.sender.fullName).toContain('User notifyB');
  });

  it('GET /api/v1/notifications/unread-count returns correct count', async () => {
    const res = await request(app).get('/api/v1/notifications/unread-count').set(auth(userA.token));
    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('filters notifications by type and isRead', async () => {
    const typeRes = await request(app)
      .get(`/api/v1/notifications?type=${NOTIFICATION_TYPES.BADGE_UNLOCKED}`)
      .set(auth(userA.token));
    expect(typeRes.status).toBe(200);
    expect(typeRes.body.data.items.length).toBe(1);
    expect(typeRes.body.data.items[0].type).toBe(NOTIFICATION_TYPES.BADGE_UNLOCKED);

    const isReadRes = await request(app).get('/api/v1/notifications?isRead=false').set(auth(userA.token));
    expect(isReadRes.status).toBe(200);
    expect(isReadRes.body.data.items.length).toBe(2);
  });

  it('PATCH /api/v1/notifications/:id/read marks single notification as read', async () => {
    const listRes = await request(app).get('/api/v1/notifications').set(auth(userA.token));
    const targetId = listRes.body.data.items[0].id;

    const readRes = await request(app)
      .patch(`/api/v1/notifications/${targetId}/read`)
      .set(auth(userA.token));

    expect(readRes.status).toBe(200);
    expect(readRes.body.data.notification.isRead).toBe(true);
    expect(readRes.body.data.notification.readAt).not.toBeNull();
    expect(readRes.body.data.unreadCount).toBe(1);

    // User B cannot mark User A's notification as read
    const forbidRes = await request(app)
      .patch(`/api/v1/notifications/${targetId}/read`)
      .set(auth(userB.token));
    expect(forbidRes.status).toBe(404);
  });

  it('PATCH /api/v1/notifications/read-all marks all notifications as read', async () => {
    const readAllRes = await request(app)
      .patch('/api/v1/notifications/read-all')
      .set(auth(userA.token));

    expect(readAllRes.status).toBe(200);
    expect(readAllRes.body.data.unreadCount).toBe(0);

    const checkRes = await request(app).get('/api/v1/notifications').set(auth(userA.token));
    expect(checkRes.body.data.unreadCount).toBe(0);
    expect(checkRes.body.data.items.every((n) => n.isRead)).toBe(true);
  });

  it('automatically creates notification when a connection request is sent', async () => {
    // User A sends connection request to User B
    const connRes = await request(app)
      .post('/api/v1/connections')
      .set(auth(userA.token))
      .send({ recipientId: userB.parentId });

    expect([200, 201]).toContain(connRes.status);

    // User B should now have a connection_request notification
    const bNotifs = await request(app).get('/api/v1/notifications').set(auth(userB.token));
    expect(bNotifs.status).toBe(200);
    const reqNotif = bNotifs.body.data.items.find((n) => n.type === NOTIFICATION_TYPES.CONNECTION_REQUEST);
    expect(reqNotif).toBeDefined();
    expect(reqNotif.data.sender.fullName).toContain('User notifyA');
  });
});
