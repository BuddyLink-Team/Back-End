import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import playdateService from '../../src/modules/playdate/playdate.service.js';
import gamificationService from '../../src/modules/gamification/gamification.service.js';
import { weekKey, weekStart } from '../../src/modules/gamification/gamification.rules.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Notify ${label}`,
    email: `notify-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  const child = await Child.create({ parentId, displayName: `Kid ${label}`, dateOfBirth: new Date('2020-01-01'), gender: 'boy' });
  await grantPremium(parentId);
  return { token: res.body.data.tokens.accessToken, parentId, childId: child._id.toString(), userId: res.body.data.user.id };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted', connectedAt: new Date() });

const auth = (parent) => ({ Authorization: `Bearer ${parent.token}` });

let nextDayOffset = 40;
const createPlaydate = async (host, guests) => {
  const res = await request(app)
    .post('/api/v1/playdates')
    .set(auth(host))
    .send({
      hostChildId: host.childId,
      scheduledDate: isoDay(nextDayOffset++),
      time: '09:00',
      activity: 'Thả diều',
      location: { name: 'Công viên', address: 'Đà Nẵng' },
      participants: guests.map((g) => ({ parentId: g.parentId, childId: g.childId })),
    });
  return res.body.data.id;
};

const waitFor = async (find, timeoutMs = 3000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = await find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return find();
};

const cancelledNotice = (parent, playdateId) =>
  Notification.findOne({ recipientId: parent.userId, type: 'playdate_cancelled', 'data.playdateId': playdateId }).lean();

describe('Playdate cancelled notification', () => {
  it('notifies joined and pending families, not declined ones, when the host cancels', async () => {
    const [host, joined, pending, declined] = await Promise.all(['h', 'j', 'p', 'd'].map(registerParent));
    await Promise.all([joined, pending, declined].map((guest) => connect(host, guest)));
    const id = await createPlaydate(host, [joined, pending, declined]);
    await request(app).put(`/api/v1/playdates/${id}/respond`).set(auth(joined)).send({ status: 'accepted' });
    await request(app).put(`/api/v1/playdates/${id}/respond`).set(auth(declined)).send({ status: 'declined' });

    const res = await request(app).patch(`/api/v1/playdates/${id}/cancel`).set(auth(host)).send({ reason: 'Bé bị ốm' });
    expect(res.status).toBe(200);

    const joinedNotice = await waitFor(() => cancelledNotice(joined, id));
    expect(joinedNotice.body).toContain('Bé bị ốm');
    expect(await waitFor(() => cancelledNotice(pending, id))).toBeTruthy();
    expect(await cancelledNotice(declined, id)).toBeNull();
    expect(await cancelledNotice(host, id)).toBeNull();
  });

  it('also notifies the host when an admin cancels, without the admin reason', async () => {
    const [host, guest] = await Promise.all(['ah', 'ag'].map(registerParent));
    await connect(host, guest);
    const id = await createPlaydate(host, [guest]);

    await playdateService.cancelPlaydateByAdmin(id, 'Báo cáo vi phạm #123');

    const hostNotice = await waitFor(() => cancelledNotice(host, id));
    expect(hostNotice.body).toContain('Quản trị viên');
    expect(hostNotice.body).not.toContain('#123');
    expect(await waitFor(() => cancelledNotice(guest, id))).toBeTruthy();
  });
});

describe('Streak reminder', () => {
  it('reminds parents with a running streak and no playdate completed this week', async () => {
    const [atRisk, safe, noStreak] = await Promise.all(['r', 's', 'n'].map(registerParent));
    const now = new Date();
    const thisWeek = weekKey(weekStart(now));
    const lastWeek = weekKey(weekStart(now) - 7 * DAY);
    await Parent.updateOne({ _id: atRisk.parentId }, { $set: { 'streak.currentWeeklyStreak': 3, 'streak.lastCompletedPlaydateWeek': lastWeek } });
    await Parent.updateOne({ _id: safe.parentId }, { $set: { 'streak.currentWeeklyStreak': 4, 'streak.lastCompletedPlaydateWeek': thisWeek } });

    await gamificationService.sendStreakReminders(now);

    const reminder = await Notification.findOne({ recipientId: atRisk.userId, type: 'streak_reminder' }).lean();
    expect(reminder.title).toContain('3 tuần');
    expect(await Notification.findOne({ recipientId: safe.userId, type: 'streak_reminder' }).lean()).toBeNull();
    expect(await Notification.findOne({ recipientId: noStreak.userId, type: 'streak_reminder' }).lean()).toBeNull();
  });
});
