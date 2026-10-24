import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import playdateService from '../../src/modules/playdate/playdate.service.js';
import { getZonedParts } from '../../src/shared/helpers/date.helper.js';

const PASSWORD = 'Password123!';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Reminder ${label}`,
    email: `pd-reminder-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  const child = await Child.create({ parentId, displayName: `Kid ${label}`, dateOfBirth: new Date('2020-01-01'), gender: 'boy' });
  const parent = await Parent.findById(parentId).lean();
  return { token: res.body.data.tokens.accessToken, parentId, userId: parent.userId.toString(), childId: child._id.toString() };
};

// Notifications are created in the background by the notification listener
const waitForReminders = async (userId, playdateId, expected) => {
  let found = [];
  for (let i = 0; i < 40; i += 1) {
    found = await Notification.find({ recipientId: userId, type: 'playdate_reminder', 'data.playdateId': playdateId }).lean();
    if (found.length >= expected) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Let any extra (unexpected) notification land before the caller checks the count
  await new Promise((resolve) => setTimeout(resolve, 100));
  return Notification.find({ recipientId: userId, type: 'playdate_reminder', 'data.playdateId': playdateId }).lean();
};

// Far in the future so the other suites' playdates (shared test DB) are never in the job window
const NOW = new Date('2031-03-10T01:00:00.000Z'); // 08:00 in Asia/Ho_Chi_Minh
const START = new Date('2031-03-11T00:00:00.000Z'); // 07:00 the next day: 23h after NOW

describe('Playdate reminders (BUD-48)', () => {
  let host;
  let accepted;
  let pending;
  let playdateId;

  beforeAll(async () => {
    [host, accepted, pending] = await Promise.all([registerParent('host'), registerParent('accepted'), registerParent('pending')]);
    const playdate = await Playdate.create({
      hostParentId: host.parentId,
      hostChildId: host.childId,
      scheduledDate: new Date('2031-03-11T00:00:00.000Z'),
      time: '07:00',
      activity: 'Thả diều',
      location: { name: 'Công viên Biển Đông', address: 'Đà Nẵng' },
      participants: [
        { parentId: accepted.parentId, childId: accepted.childId, status: 'accepted' },
        { parentId: pending.parentId, childId: pending.childId, status: 'pending' },
      ],
    });
    playdateId = playdate._id.toString();
  });

  it('sends the 24h reminder once, to the host and accepted participants only', async () => {
    const first = await playdateService.sendDueReminders(NOW);
    expect(first.h24).toBe(1);
    const second = await playdateService.sendDueReminders(NOW);
    expect(second).toEqual({ h24: 0, h1: 0 });

    const hostReminders = await waitForReminders(host.userId, playdateId, 1);
    expect(hostReminders).toHaveLength(1);
    expect(hostReminders[0].title).toBe('Nhắc lịch Playdate');
    expect(hostReminders[0].body).toBe('"Thả diều" diễn ra lúc 07:00 ngày 11/03 tại Công viên Biển Đông.');
    expect(await waitForReminders(accepted.userId, playdateId, 1)).toHaveLength(1);
    expect(await waitForReminders(pending.userId, playdateId, 0)).toHaveLength(0);
  });

  it('sends the 1h reminder once', async () => {
    const soon = new Date(START.getTime() - 50 * MINUTE);
    expect((await playdateService.sendDueReminders(soon)).h1).toBe(1);
    expect((await playdateService.sendDueReminders(soon)).h1).toBe(0);

    const hostReminders = await waitForReminders(host.userId, playdateId, 2);
    expect(hostReminders).toHaveLength(2);
    expect(hostReminders.find((n) => n.title === 'Playdate sắp bắt đầu').body).toBe(
      '"Thả diều" sẽ bắt đầu lúc 07:00 tại Công viên Biển Đông. Chuẩn bị lên đường nhé!'
    );
  });

  it('runs concurrently without sending a reminder twice', async () => {
    const other = await Playdate.create({
      hostParentId: host.parentId,
      hostChildId: host.childId,
      scheduledDate: new Date('2031-03-11T00:00:00.000Z'),
      // Exactly 24h after NOW
      time: '08:00',
      activity: 'Picnic',
      location: { name: 'Park', address: 'Đà Nẵng' },
    });
    const runs = await Promise.all([playdateService.sendDueReminders(NOW), playdateService.sendDueReminders(NOW)]);
    expect(runs[0].h24 + runs[1].h24).toBe(1);
    expect(await waitForReminders(host.userId, other._id.toString(), 1)).toHaveLength(1);
  });

  it('skips the 24h reminder of a playdate created less than 24h before it starts', async () => {
    const starts = getZonedParts(new Date(Date.now() + 3 * HOUR));
    const pad = (value) => String(value).padStart(2, '0');
    const res = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${accepted.token}`)
      .send({
        hostChildId: accepted.childId,
        scheduledDate: `${starts.year}-${pad(starts.month)}-${pad(starts.day)}`,
        time: `${pad(starts.hour)}:${pad(starts.minute)}`,
        activity: 'Last minute',
        location: { name: 'Park', address: 'Đà Nẵng' },
      });
    expect(res.status).toBe(201);
    const stored = await Playdate.findById(res.body.data.id).lean();
    expect(stored.reminders.h24SentAt).not.toBeNull();
    expect(stored.reminders.h1SentAt).toBeNull();
  });

  it('resets the reminders when the playdate is rescheduled', async () => {
    const solo = await registerParent('solo');
    const created = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${solo.token}`)
      .send({
        hostChildId: solo.childId,
        scheduledDate: '2031-04-01',
        time: '09:00',
        activity: 'Vẽ tranh',
        location: { name: 'Park', address: 'Đà Nẵng' },
      });
    await Playdate.updateOne({ _id: created.body.data.id }, { $set: { reminders: { h24SentAt: new Date(), h1SentAt: new Date() } } });

    // Nobody accepted: the new schedule applies at once
    const moved = await request(app)
      .post(`/api/v1/playdates/${created.body.data.id}/reschedule`)
      .set('Authorization', `Bearer ${solo.token}`)
      .send({ newDate: '2031-04-02', newStartTime: '10:00' });
    expect(moved.status).toBe(201);
    expect(moved.body.data.isAutoApplied).toBe(true);

    const stored = await Playdate.findById(created.body.data.id).lean();
    expect(stored.reminders).toEqual({ h24SentAt: null, h1SentAt: null });
  });
});
