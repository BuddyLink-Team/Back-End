import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Schedule ${label}`,
    email: `pd-schedule-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: 'Password123!',
  });
  const parentId = res.body.data.parent.id;
  const child = await Child.create({ parentId, displayName: `Bé ${label}`, dateOfBirth: new Date('2020-01-01'), gender: 'girl' });
  return { token: res.body.data.tokens.accessToken, parentId, childId: child._id.toString() };
};

const playdate = (host, overrides) =>
  Playdate.create({
    hostParentId: host.parentId,
    hostChildId: host.childId,
    activity: overrides.activity,
    location: { name: 'Park', address: 'Đà Nẵng' },
    ...overrides,
  });

describe('Playdate list order', () => {
  it('lists upcoming playdates soonest first (date and time), then past ones most recent first', async () => {
    const host = await registerParent('order');
    await playdate(host, { activity: 'in 5 days 15:00', scheduledDate: new Date(isoDay(5)), time: '15:00' });
    await playdate(host, { activity: 'completed 10 days ago', scheduledDate: new Date(isoDay(-10)), time: '09:00', status: 'completed' });
    await playdate(host, { activity: 'in 5 days 09:00', scheduledDate: new Date(isoDay(5)), time: '09:00' });
    await playdate(host, { activity: 'cancelled yesterday', scheduledDate: new Date(isoDay(-1)), time: '09:00', status: 'cancelled' });
    await playdate(host, { activity: 'in 2 days 10:00', scheduledDate: new Date(isoDay(2)), time: '10:00' });
    await playdate(host, { activity: 'completed 3 days ago', scheduledDate: new Date(isoDay(-3)), time: '16:00', status: 'completed' });

    const list = (status, extra = '') =>
      request(app).get(`/api/v1/playdates?status=${status}${extra}`).set('Authorization', `Bearer ${host.token}`);
    const titles = (res) => res.body.data.playdates.map((p) => p.activity);

    expect(titles(await list('all'))).toEqual([
      'in 2 days 10:00',
      'in 5 days 09:00',
      'in 5 days 15:00',
      'cancelled yesterday',
      'completed 3 days ago',
      'completed 10 days ago',
    ]);
    expect(titles(await list('upcoming'))).toEqual(['in 2 days 10:00', 'in 5 days 09:00', 'in 5 days 15:00']);
    expect(titles(await list('completed'))).toEqual(['completed 3 days ago', 'completed 10 days ago']);

    // Pages follow the same order
    const page2 = await list('all', '&limit=2&page=2');
    expect(titles(page2)).toEqual(['in 5 days 15:00', 'cancelled yesterday']);
    expect(page2.body.data.pagination.total).toBe(6);
  });
});

describe('GET /playdates/busy-times', () => {
  it('lists when the children are already busy that day, sharing only the time for a friend child', async () => {
    const host = await registerParent('busy-host');
    const friend = await registerParent('busy-friend');
    const stranger = await registerParent('busy-stranger');
    await Connection.create({ parents: [host.parentId, friend.parentId], requesterId: host.parentId, recipientId: friend.parentId, status: 'accepted' });

    const day = isoDay(6);
    const own = await playdate(host, { activity: 'Own', scheduledDate: new Date(day), time: '09:00', durationMinutes: 90 });
    await playdate(friend, { activity: 'Friend', scheduledDate: new Date(day), time: '15:00' });
    // Another day: not listed
    await playdate(friend, { activity: 'Other day', scheduledDate: new Date(isoDay(7)), time: '15:00' });

    const busyTimes = (query) =>
      request(app).get(`/api/v1/playdates/busy-times?${new URLSearchParams(query)}`).set('Authorization', `Bearer ${host.token}`);

    const res = await busyTimes({ childId: host.childId, participantChildIds: friend.childId, date: day });
    expect(res.status).toBe(200);
    expect(res.body.data.busy).toEqual([
      expect.objectContaining({ childId: host.childId, childName: 'Bé busy-host', isOwnChild: true, start: '09:00', end: '10:30', playdateId: own._id.toString() }),
      expect.objectContaining({ childId: friend.childId, childName: 'Bé busy-friend', isOwnChild: false, start: '15:00', end: '17:00' }),
    ]);
    // A friend's child: the time only, never which playdate
    expect(res.body.data.busy[1]).not.toHaveProperty('playdateId');

    // The playdate being rescheduled or answered is left out
    const excluded = await busyTimes({ childId: host.childId, date: day, excludePlaydateId: own._id.toString() });
    expect(excluded.body.data.busy).toEqual([]);

    const notFriend = await busyTimes({ childId: host.childId, participantChildIds: stranger.childId, date: day });
    expect(notFriend.status).toBe(403);
    const missingDate = await busyTimes({ childId: host.childId });
    expect(missingDate.status).toBe(400);
  });

  it('gives the viewer their own child in a playdate', async () => {
    const host = await registerParent('mychild-host');
    const guest = await registerParent('mychild-guest');
    const created = await playdate(host, {
      activity: 'Invite',
      scheduledDate: new Date(isoDay(4)),
      time: '09:00',
      participants: [{ parentId: guest.parentId, childId: guest.childId, status: 'pending' }],
    });

    const forGuest = await request(app).get(`/api/v1/playdates/${created._id}`).set('Authorization', `Bearer ${guest.token}`);
    expect(forGuest.body.data.myChildId).toBe(guest.childId);
    const forHost = await request(app).get(`/api/v1/playdates/${created._id}`).set('Authorization', `Bearer ${host.token}`);
    expect(forHost.body.data.myChildId).toBe(host.childId);
  });
});
