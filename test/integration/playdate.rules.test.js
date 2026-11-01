import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Block from '../../src/modules/safety/block.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import RescheduleRequest from '../../src/modules/playdate/reschedule-request.model.js';
import UsageQuota from '../../src/modules/subscription/usage-quota.model.js';
import subscriptionService from '../../src/modules/subscription/subscription.service.js';
import playdateService from '../../src/modules/playdate/playdate.service.js';
import rescheduleRepository from '../../src/modules/playdate/reschedule.repository.js';
import { QUOTA_PERIOD_TYPES } from '../../src/modules/subscription/subscription.constants.js';
import { getScheduledStart, getStartOfZonedDay } from '../../src/shared/helpers/date.helper.js';

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Rules ${label}`,
    email: `pd-rules-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  const child = await Child.create({ parentId, displayName: `Kid ${label}`, dateOfBirth: new Date('2020-01-01'), gender: 'girl' });
  return { token: res.body.data.tokens.accessToken, parentId, childId: child._id.toString() };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted', connectedAt: new Date() });

const createPlaydate = (host, guests, overrides = {}) =>
  request(app)
    .post('/api/v1/playdates')
    .set('Authorization', `Bearer ${host.token}`)
    .send({
      hostChildId: host.childId,
      scheduledDate: isoDay(5),
      time: '09:00',
      activity: 'Đạp xe công viên',
      location: { name: 'Công viên APEC', address: 'Bạch Đằng, Phường Hải Châu, Đà Nẵng' },
      participants: guests.map((g) => ({ parentId: g.parentId, childId: g.childId })),
      ...overrides,
    });

const respond = (parent, playdateId, status) =>
  request(app).put(`/api/v1/playdates/${playdateId}/respond`).set('Authorization', `Bearer ${parent.token}`).send({ status });

const reschedule = (host, playdateId, body) =>
  request(app).post(`/api/v1/playdates/${playdateId}/reschedule`).set('Authorization', `Bearer ${host.token}`).send(body);

const vote = (parent, playdateId, body) =>
  request(app).put(`/api/v1/playdates/${playdateId}/reschedule/vote`).set('Authorization', `Bearer ${parent.token}`).send(body);

const cancelReschedule = (parent, playdateId, body = {}) =>
  request(app).patch(`/api/v1/playdates/${playdateId}/reschedule/cancel`).set('Authorization', `Bearer ${parent.token}`).send(body);

describe('date helper (business time zone)', () => {
  it('builds the start instant from the calendar date and HH:mm in Asia/Ho_Chi_Minh', () => {
    const expected = '2026-10-10T02:30:00.000Z'; // 09:30 in UTC+7
    expect(getScheduledStart('2026-10-10T00:00:00.000Z', '09:30').toISOString()).toBe(expected);
    // Same calendar day when the client sent local midnight
    expect(getScheduledStart('2026-10-09T17:00:00.000Z', '09:30').toISOString()).toBe(expected);
  });

  it('returns 00:00 of the current day in the business time zone', () => {
    expect(getStartOfZonedDay(new Date('2026-10-10T20:00:00.000Z')).toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });
});

describe('Playdate rules', () => {
  let host;
  let guestA;
  let guestB;

  beforeAll(async () => {
    host = await registerParent('host');
    guestA = await registerParent('a');
    guestB = await registerParent('b');
    await connect(host, guestA);
    await connect(host, guestB);
    await Parent.updateOne(
      { _id: host.parentId },
      { $set: { location: { address: '12 Lê Duẩn, Phường Hải Châu', area: 'Phường Hải Châu', city: 'Đà Nẵng', coordinates: { type: 'Point', coordinates: [108.2208, 16.0678] } } } },
    );
  });

  // The same host child is reused: every playdate gets its own day so they never overlap (SCHEDULE_CONFLICT)
  it('never exposes a family exact address or coordinates', async () => {
    const created = await createPlaydate(host, [guestA], { scheduledDate: isoDay(20) });
    expect(created.status).toBe(201);

    const detail = await request(app).get(`/api/v1/playdates/${created.body.data.id}`).set('Authorization', `Bearer ${guestA.token}`);
    expect(detail.body.data.hostParent.location).toEqual({ area: 'Phường Hải Châu', city: 'Đà Nẵng' });

    const friends = await request(app).get('/api/v1/playdates/friends').set('Authorization', `Bearer ${guestA.token}`);
    expect(friends.body.data[0].location).toEqual({ area: 'Phường Hải Châu', city: 'Đà Nẵng' });
  });

  it('rejects inviting a blocked parent without consuming the creation quota', async () => {
    const blocker = await registerParent('blocker');
    const blocked = await registerParent('blocked');
    await connect(blocker, blocked);
    await Block.create({ blockerId: blocked.parentId, blockedId: blocker.parentId });

    const res = await createPlaydate(blocker, [blocked]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BLOCKED_INTERACTION');

    const quota = await subscriptionService.getQuotaSummary(blocker.parentId);
    expect(quota.usage.playdatesCreatedThisMonth).toBe(0);

    // Blocked parents are not offered as invitable friends, in either direction
    for (const parent of [blocker, blocked]) {
      const friends = await request(app).get('/api/v1/playdates/friends').set('Authorization', `Bearer ${parent.token}`);
      expect(friends.status).toBe(200);
      expect(friends.body.data).toHaveLength(0);
    }
  });

  it('only accepts a single HH:mm start time', async () => {
    const res = await createPlaydate(host, [guestA], { time: '09:00 - 11:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a playdate that starts in the past', async () => {
    const res = await createPlaydate(host, [guestA], { scheduledDate: isoDay(0), time: '00:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLAYDATE_IN_PAST');
  });

  it('keeps the invitation pending when the participation quota is used up', async () => {
    const created = await createPlaydate(host, [guestB], { scheduledDate: isoDay(21) });
    await UsageQuota.updateOne(
      { parentId: guestB.parentId, periodType: QUOTA_PERIOD_TYPES.MONTHLY, periodValue: subscriptionService.getPeriodValue(QUOTA_PERIOD_TYPES.MONTHLY) },
      { $set: { 'counters.playdatesParticipated': 3 } },
      { upsert: true },
    );

    const res = await respond(guestB, created.body.data.id, 'accepted');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');

    const stored = await Playdate.findById(created.body.data.id).lean();
    expect(stored.participants[0].status).toBe('pending');

    await UsageQuota.updateOne(
      { parentId: guestB.parentId, periodType: QUOTA_PERIOD_TYPES.MONTHLY },
      { $set: { 'counters.playdatesParticipated': 0 } },
    );
  });

  describe('reschedule (PROJECT_OVERVIEW 6.2)', () => {
    let playdateId;

    beforeAll(async () => {
      const created = await createPlaydate(host, [guestA, guestB]);
      playdateId = created.body.data.id;
      await respond(guestA, playdateId, 'accepted');
    });

    it('needs both a name and an address for a new location', async () => {
      const res = await reschedule(host, playdateId, { newDate: isoDay(6), newStartTime: '10:00', newLocation: { name: 'Sun World' } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a schedule in the past or identical to the current one', async () => {
      const past = await reschedule(host, playdateId, { newDate: isoDay(0), newStartTime: '00:00' });
      expect(past.body.error.code).toBe('RESCHEDULE_IN_PAST');

      const same = await reschedule(host, playdateId, { newDate: isoDay(5), newStartTime: '09:00' });
      expect(same.body.error.code).toBe('RESCHEDULE_NO_CHANGE');
    });

    it('asks every accepted participant, including one who accepts after the proposal', async () => {
      const proposal = await reschedule(host, playdateId, { newDate: isoDay(7), newStartTime: '15:30', reason: 'Trời mưa' });
      expect(proposal.status).toBe(201);
      expect(proposal.body.data.rescheduleRequest.status).toBe('pending');
      expect(proposal.body.data.rescheduleRequest.isRequester).toBe(true);

      // B accepts the playdate while the proposal is pending -> becomes a voter too
      await respond(guestB, playdateId, 'accepted');
      const forB = await request(app).get(`/api/v1/playdates/${playdateId}/reschedule`).set('Authorization', `Bearer ${guestB.token}`);
      expect(forB.body.data.myVote).toBe('pending');

      const requestId = proposal.body.data.rescheduleRequest.id;
      const afterA = await vote(guestA, playdateId, { requestId, status: 'accepted' });
      expect(afterA.body.data.rescheduleRequest.status).toBe('pending');
      expect(afterA.body.data.rescheduleRequest.myVote).toBe('accepted');

      const afterB = await vote(guestB, playdateId, { requestId, status: 'accepted' });
      expect(afterB.body.data.rescheduleRequest.status).toBe('accepted');
      expect(afterB.body.data.playdate.time).toBe('15:30');
    });

    it('keeps the old schedule when one participant declines', async () => {
      const proposal = await reschedule(host, playdateId, { newDate: isoDay(8), newStartTime: '08:00' });
      const requestId = proposal.body.data.rescheduleRequest.id;
      const res = await vote(guestA, playdateId, { requestId, status: 'declined' });
      expect(res.body.data.rescheduleRequest.status).toBe('declined');
      expect(res.body.data.playdate.time).toBe('15:30');
    });

    it('lets only the host withdraw a pending proposal, keeping the schedule', async () => {
      const proposal = await reschedule(host, playdateId, { newDate: isoDay(8), newStartTime: '08:00' });
      const requestId = proposal.body.data.rescheduleRequest.id;

      const byGuest = await cancelReschedule(guestA, playdateId, { requestId });
      expect(byGuest.status).toBe(403);
      expect(byGuest.body.error.code).toBe('FORBIDDEN_CANCEL_RESCHEDULE');

      const res = await cancelReschedule(host, playdateId, { requestId });
      expect(res.status).toBe(200);
      expect(res.body.data.rescheduleRequest.status).toBe('cancelled');
      expect(res.body.data.playdate.time).toBe('15:30');

      // Already withdrawn: nothing left to withdraw or to vote on
      const again = await cancelReschedule(host, playdateId, { requestId });
      expect(again.status).toBe(404);
      expect(again.body.error.code).toBe('RESCHEDULE_NOT_FOUND');
      const lateVote = await vote(guestA, playdateId, { requestId, status: 'accepted' });
      expect(lateVote.status).toBe(404);
    });

    it('does not withdraw a newer proposal than the one on screen', async () => {
      const old = await reschedule(host, playdateId, { newDate: isoDay(8), newStartTime: '08:00' });
      const newer = await reschedule(host, playdateId, { newDate: isoDay(8), newStartTime: '09:00' });

      const res = await cancelReschedule(host, playdateId, { requestId: old.body.data.rescheduleRequest.id });
      expect(res.status).toBe(404);
      const stored = await RescheduleRequest.findById(newer.body.data.rescheduleRequest.id).lean();
      expect(stored.status).toBe('pending');
    });

    it('keeps the schedule when the host withdraws while the last vote is being recorded', async () => {
      const proposal = await reschedule(host, playdateId, { newDate: isoDay(8), newStartTime: '08:00' });
      const requestId = proposal.body.data.rescheduleRequest.id;
      await vote(guestA, playdateId, { requestId, status: 'accepted' });

      // The host withdraws right after the vote of B is stored, before the request is resolved
      const recordVote = rescheduleRepository.findOneAndUpdate.bind(rescheduleRepository);
      const spy = jest.spyOn(rescheduleRepository, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
        const stored = await recordVote(...args);
        await cancelReschedule(host, playdateId, { requestId });
        return stored;
      });

      const res = await vote(guestB, playdateId, { requestId, status: 'accepted' });
      spy.mockRestore();

      expect(res.status).toBe(404);
      const stored = await RescheduleRequest.findById(requestId).lean();
      expect(stored.status).toBe('cancelled');
      const playdate = await Playdate.findById(playdateId).lean();
      expect(playdate.time).toBe('15:30');
    });

    it('cancels a pending reschedule when the host completes the playdate', async () => {
      const proposal = await reschedule(host, playdateId, { newDate: isoDay(9), newStartTime: '08:00' });
      await Playdate.updateOne({ _id: playdateId }, { $set: { scheduledDate: new Date(Date.now() - 2 * DAY) } });

      const done = await request(app).patch(`/api/v1/playdates/${playdateId}/complete`).set('Authorization', `Bearer ${host.token}`);
      expect(done.status).toBe(200);
      const stored = await RescheduleRequest.findById(proposal.body.data.rescheduleRequest.id).lean();
      expect(stored.status).toBe('cancelled');

      // A closed playdate has no proposal to withdraw
      const withdraw = await cancelReschedule(host, playdateId);
      expect(withdraw.status).toBe(400);
      expect(withdraw.body.error.code).toBe('INVALID_PLAYDATE_STATUS_FOR_RESCHEDULE');
    });
  });

  describe('leave', () => {
    const leave = (parent, playdateId) =>
      request(app).post(`/api/v1/playdates/${playdateId}/leave`).set('Authorization', `Bearer ${parent.token}`);

    let leaveHost;
    let leaverA;
    let leaverB;

    // Own host: the shared host already used its monthly creation quota
    beforeAll(async () => {
      leaveHost = await registerParent('leave-host');
      leaverA = await registerParent('leave-a');
      leaverB = await registerParent('leave-b');
      await connect(leaveHost, leaverA);
      await connect(leaveHost, leaverB);
    });

    it('drops the leaver from a pending reschedule and applies it once the others agreed', async () => {
      const created = await createPlaydate(leaveHost, [leaverA, leaverB], { scheduledDate: isoDay(25) });
      const playdateId = created.body.data.id;
      await respond(leaverA, playdateId, 'accepted');
      await respond(leaverB, playdateId, 'accepted');

      const proposal = await reschedule(leaveHost, playdateId, { newDate: isoDay(26), newStartTime: '16:00' });
      const requestId = proposal.body.data.rescheduleRequest.id;
      await vote(leaverA, playdateId, { requestId, status: 'accepted' });

      const res = await leave(leaverB, playdateId);
      expect(res.status).toBe(200);

      const stored = await RescheduleRequest.findById(requestId).lean();
      expect(stored.status).toBe('accepted');
      expect(stored.responses.map((r) => r.parentId.toString())).toEqual([leaverA.parentId]);

      const playdate = await Playdate.findById(playdateId).lean();
      expect(playdate.time).toBe('16:00');
      expect(playdate.participants.find((p) => p.parentId.toString() === leaverB.parentId).status).toBe('declined');
    });

    it('rejects leaving twice and leaving as the host', async () => {
      const created = await createPlaydate(leaveHost, [leaverA], { scheduledDate: isoDay(27) });
      const playdateId = created.body.data.id;

      expect((await leave(leaverA, playdateId)).status).toBe(200);
      const again = await leave(leaverA, playdateId);
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('ALREADY_LEFT');

      const asHost = await leave(leaveHost, playdateId);
      expect(asHost.status).toBe(400);
      expect(asHost.body.error.code).toBe('HOST_CANNOT_LEAVE');
    });
  });

  describe('daily auto-close job', () => {
    it('completes past playdates with an accepted participant and cancels those nobody joined', async () => {
      const base = {
        hostParentId: host.parentId,
        hostChildId: host.childId,
        time: '09:00',
        activity: 'Dã ngoại',
        location: { name: 'Công viên Biển Đông', address: 'Võ Nguyên Giáp, Đà Nẵng' },
        status: 'upcoming',
      };
      const twoDaysAgo = new Date(Date.now() - 2 * DAY);
      const joined = await Playdate.create({ ...base, scheduledDate: twoDaysAgo, participants: [{ parentId: guestA.parentId, childId: guestA.childId, status: 'accepted' }] });
      const nobody = await Playdate.create({ ...base, scheduledDate: twoDaysAgo, participants: [{ parentId: guestB.parentId, childId: guestB.childId, status: 'pending' }] });
      const later = await Playdate.create({ ...base, scheduledDate: new Date(Date.now() + 3 * DAY), participants: [] });

      const result = await playdateService.closeExpiredPlaydates();
      expect(result.completed).toBeGreaterThanOrEqual(1);
      expect(result.cancelled).toBeGreaterThanOrEqual(1);

      expect((await Playdate.findById(joined._id).lean()).status).toBe('completed');
      const cancelled = await Playdate.findById(nobody._id).lean();
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancellation.reason).toBe('No participant accepted the invitation');
      expect((await Playdate.findById(later._id).lean()).status).toBe('upcoming');
    });
  });
});

describe('Playdate duration (BUD-48)', () => {
  it('defaults to 2 hours, exposes the end time and rejects durations out of range', async () => {
    const host = await registerParent('duration-host');

    const created = await createPlaydate(host, [], { time: '23:00' });
    expect(created.status).toBe(201);
    expect(created.body.data.durationMinutes).toBe(120);
    expect(created.body.data.endTime).toBe('01:00');
    expect(created.body.data.warnings).toEqual([]);

    for (const durationMinutes of [29, 481]) {
      const res = await createPlaydate(host, [], { scheduledDate: isoDay(9), durationMinutes });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }

    const custom = await createPlaydate(host, [], { scheduledDate: isoDay(9), time: '10:00', durationMinutes: 90 });
    expect(custom.body.data.durationMinutes).toBe(90);
    expect(custom.body.data.endTime).toBe('11:30');
  });
});

describe('Schedule conflicts (BUD-48)', () => {
  let host;
  let guest;

  beforeEach(async () => {
    host = await registerParent('conflict-host');
    guest = await registerParent('conflict-guest');
    await connect(host, guest);
  });

  it('blocks a second playdate of the host child at an overlapping time, but not a touching one', async () => {
    expect((await createPlaydate(host, [], { time: '10:00' })).status).toBe(201);

    const overlapping = await createPlaydate(host, [], { time: '11:00' });
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(overlapping.body.error.details[0].playdateId).toBeDefined();

    // 10:00-12:00 then 12:00-14:00: edges touch, no conflict
    expect((await createPlaydate(host, [], { time: '12:00' })).status).toBe(201);
  });

  it('only warns when an invited child is busy, and blocks that child on accept (decline stays possible)', async () => {
    const otherHost = await registerParent('conflict-other-host');
    await connect(otherHost, guest);
    const busy = await createPlaydate(otherHost, [guest], { time: '10:00' });
    await respond(guest, busy.body.data.id, 'accepted');

    const created = await createPlaydate(host, [guest], { time: '11:00' });
    expect(created.status).toBe(201);
    expect(created.body.data.warnings).toEqual([{ code: 'SCHEDULE_CONFLICT', childId: guest.childId }]);

    const accept = await respond(guest, created.body.data.id, 'accepted');
    expect(accept.status).toBe(409);
    expect(accept.body.error.code).toBe('SCHEDULE_CONFLICT');

    const decline = await respond(guest, created.body.data.id, 'declined');
    expect(decline.status).toBe(200);
  });

  it('checks the host child on reschedule, excluding the playdate being moved', async () => {
    const first = await createPlaydate(host, [], { time: '09:00' });
    await createPlaydate(host, [], { time: '14:00' });

    // Moving 09:00 -> 10:00 overlaps only with itself: allowed (applied at once, nobody accepted)
    const self = await reschedule(host, first.body.data.id, { newDate: isoDay(5), newStartTime: '10:00' });
    expect(self.status).toBe(201);

    const clash = await reschedule(host, first.body.data.id, { newDate: isoDay(5), newStartTime: '13:00' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');

    // A longer duration alone is a change too, and is checked the same way
    const longer = await reschedule(host, first.body.data.id, { newDate: isoDay(5), newStartTime: '10:00', newDurationMinutes: 300 });
    expect(longer.status).toBe(409);
  });

  it('blocks accepting a reschedule that clashes with the voter child, declining stays possible', async () => {
    const created = await createPlaydate(host, [guest], { time: '09:00' });
    await respond(guest, created.body.data.id, 'accepted');

    const otherHost = await registerParent('conflict-vote-host');
    await connect(otherHost, guest);
    const busy = await createPlaydate(otherHost, [guest], { time: '15:00' });
    await respond(guest, busy.body.data.id, 'accepted');

    const proposal = await reschedule(host, created.body.data.id, { newDate: isoDay(5), newStartTime: '15:30' });
    expect(proposal.status).toBe(201);
    const requestId = proposal.body.data.rescheduleRequest.id;

    const accept = await vote(guest, created.body.data.id, { requestId, status: 'accepted' });
    expect(accept.status).toBe(409);
    expect(accept.body.error.code).toBe('SCHEDULE_CONFLICT');

    const decline = await vote(guest, created.body.data.id, { requestId, status: 'declined' });
    expect(decline.status).toBe(200);
    expect(decline.body.data.rescheduleRequest.status).toBe('declined');
  });
});
