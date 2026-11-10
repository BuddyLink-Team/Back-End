import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import PlaydateLeave from '../../src/modules/playdate/playdate-leave.model.js';
import Block from '../../src/modules/safety/block.model.js';
import AdminNotification from '../../src/modules/admin/admin-notification.model.js';
import adminService from '../../src/modules/admin/admin.service.js';
import playdateService from '../../src/modules/playdate/playdate.service.js';
import { isLateLeave, reliabilityLevelOf } from '../../src/modules/playdate/playdate.rules.js';
import { getZonedParts } from '../../src/shared/helpers/date.helper.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

const PASSWORD = 'Password123!';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Leave ${label}`,
    email: `pd-leave-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  const child = await Child.create({ parentId, displayName: `Kid ${label}`, dateOfBirth: new Date('2020-01-01'), gender: 'girl' });
  // Premium: no monthly creation / participation limit gets in the way
  await grantPremium(parentId);
  return { token: res.body.data.tokens.accessToken, parentId, childId: child._id.toString(), userId: res.body.data.user.id };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted', connectedAt: new Date() });

const auth = (parent) => ({ Authorization: `Bearer ${parent.token}` });

// Every playdate on its own day: the host's child cannot be in two at once
let nextDayOffset = 10;

/** Host creates a playdate the guests accept; returns its id */
const joinedPlaydate = async (host, guests) => {
  const created = await request(app)
    .post('/api/v1/playdates')
    .set(auth(host))
    .send({
      hostChildId: host.childId,
      scheduledDate: isoDay(nextDayOffset++),
      time: '09:00',
      activity: 'Đạp xe công viên',
      location: { name: 'Công viên APEC', address: 'Bạch Đằng, Đà Nẵng' },
      participants: guests.map((g) => ({ parentId: g.parentId, childId: g.childId })),
    });
  const id = created.body.data.id;
  for (const guest of guests) {
    await request(app).put(`/api/v1/playdates/${id}/respond`).set(auth(guest)).send({ status: 'accepted' });
  }
  return id;
};

// Move the start of a playdate to an instant (calendar day + HH:mm in the business time zone)
const moveStartTo = async (playdateId, instant) => {
  const parts = getZonedParts(instant);
  await Playdate.updateOne(
    { _id: playdateId },
    { $set: { scheduledDate: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)), time: `${pad(parts.hour)}:${pad(parts.minute)}` } }
  );
};

const leave = (parent, playdateId, body = {}) =>
  request(app).post(`/api/v1/playdates/${playdateId}/leave`).set(auth(parent)).send(body);
const view = async (parent, playdateId) => (await request(app).get(`/api/v1/playdates/${playdateId}`).set(auth(parent))).body.data;
const myReliability = async (parent) => (await request(app).get('/api/v1/playdates/reliability/me').set(auth(parent))).body.data;

const waitFor = async (find, { timeoutMs = 3000, intervalMs = 50 } = {}) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const found = await find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
};

describe('Leave rules (pure)', () => {
  it('is a late leave less than 24h before the start', () => {
    const now = new Date('2026-11-10T00:00:00.000Z');
    expect(isLateLeave(new Date(now.getTime() + 23 * HOUR), now)).toBe(true);
    expect(isLateLeave(new Date(now.getTime() + 24 * HOUR), now)).toBe(false);
  });

  it('maps late leaves to a reliability level', () => {
    expect(reliabilityLevelOf(0)).toBe('good');
    expect(reliabilityLevelOf(2)).toBe('fair');
    expect(reliabilityLevelOf(3)).toBe('at_risk');
  });
});

describe('Leaving a playdate (POST /playdates/:id/leave) and reliability', () => {
  let host;

  beforeAll(async () => {
    host = await registerParent('host');
  });

  it('records an early leave without counting it as late, and tells the host', async () => {
    const guest = await registerParent('early');
    await connect(host, guest);
    const id = await joinedPlaydate(host, [guest]);

    const res = await leave(guest, id, { reason: 'Bé bị ốm' });
    expect(res.status).toBe(200);
    expect(res.body.data.myParticipantStatus).toBe('declined');

    const stored = await PlaydateLeave.findOne({ playdateId: id, parentId: guest.parentId }).lean();
    expect(stored).toMatchObject({ isLate: false, safetyExempt: false, reason: 'Bé bị ốm' });

    const reliability = await myReliability(guest);
    expect(reliability).toMatchObject({ level: 'good', leaves: 1, lateLeaves: 0, windowDays: 90, lateLeaveHours: 24 });

    const notification = await waitFor(() => Notification.findOne({ recipientId: host.userId, type: 'playdate_left', 'data.playdateId': id }).lean());
    expect(notification.body).toContain('Bé bị ốm');
    expect(notification.body).not.toContain('sát giờ');
  }, 20000);

  it('counts a leave less than 24h before the start as late', async () => {
    const guest = await registerParent('late');
    await connect(host, guest);
    const id = await joinedPlaydate(host, [guest]);
    await moveStartTo(id, new Date(Date.now() + 3 * HOUR));

    expect((await view(guest, id)).isLateLeave).toBe(true);
    expect((await leave(guest, id)).status).toBe(200);

    expect(await myReliability(guest)).toMatchObject({ level: 'fair', leaves: 1, lateLeaves: 1, totalLateLeaves: 1 });
    const notification = await waitFor(() => Notification.findOne({ recipientId: host.userId, type: 'playdate_left', 'data.playdateId': id }).lean());
    expect(notification.body).toContain('sát giờ');
  }, 20000);

  it('never counts a late leave after blocking a member, and keeps the reason away from the host', async () => {
    const blocker = await registerParent('blocker');
    const other = await registerParent('other');
    await Promise.all([connect(host, blocker), connect(host, other)]);
    const id = await joinedPlaydate(host, [blocker, other]);
    await moveStartTo(id, new Date(Date.now() + 3 * HOUR));
    await Block.create({ blockerId: blocker.parentId, blockedId: other.parentId });

    expect((await view(blocker, id)).isLateLeave).toBe(false);
    expect((await leave(blocker, id, { reason: 'Không muốn gặp người này' })).status).toBe(200);

    const stored = await PlaydateLeave.findOne({ playdateId: id, parentId: blocker.parentId }).lean();
    expect(stored).toMatchObject({ isLate: false, safetyExempt: true, reason: '' });
    expect(await myReliability(blocker)).toMatchObject({ level: 'good', leaves: 0, lateLeaves: 0 });

    const notification = await waitFor(() => Notification.findOne({ recipientId: host.userId, type: 'playdate_left', 'data.playdateId': id }).lean());
    expect(notification.body).not.toContain('Lý do');
  }, 20000);

  it('cannot be left once started, and rejects a reason that is too long', async () => {
    const guest = await registerParent('started');
    await connect(host, guest);
    const id = await joinedPlaydate(host, [guest]);

    const tooLong = await leave(guest, id, { reason: 'x'.repeat(301) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.code).toBe('VALIDATION_ERROR');

    await moveStartTo(id, new Date(Date.now() - 10 * 60 * 1000));
    expect((await view(guest, id)).canLeave).toBe(false);
    const started = await leave(guest, id);
    expect(started.status).toBe(400);
    expect(started.body.error.code).toBe('PLAYDATE_ALREADY_STARTED');
  }, 20000);

  it('warns the admins once the parent reaches 3 late leaves, and shows the reliability on the admin detail', async () => {
    const flaky = await registerParent('flaky');
    await connect(host, flaky);

    for (let i = 0; i < 3; i += 1) {
      const id = await joinedPlaydate(host, [flaky]);
      await moveStartTo(id, new Date(Date.now() + (2 + i) * HOUR));
      expect((await leave(flaky, id)).status).toBe(200);
    }

    const alert = await waitFor(() => AdminNotification.findOne({ type: 'reliability_at_risk', entityId: flaky.userId }).lean());
    expect(alert.severity).toBe('warning');

    const detail = await adminService.getUserDetail(flaky.userId);
    expect(detail.activity.reliability).toMatchObject({ level: 'at_risk', lateLeaves: 3 });

    // Outside the window: no longer counted, still in the all-time total
    const later = await playdateService.getReliabilityForParent(flaky.parentId, new Date(Date.now() + 91 * DAY));
    expect(later).toMatchObject({ level: 'good', lateLeaves: 0, totalLateLeaves: 3 });
  }, 30000);
});
