import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import Block from '../../src/modules/safety/block.model.js';
import subscriptionService from '../../src/modules/subscription/subscription.service.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Invite ${label}`,
    email: `pd-invite-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  const child = await Child.create({ parentId, displayName: `Kid ${label}`, dateOfBirth: new Date('2020-01-01'), gender: 'girl' });
  return { token: res.body.data.tokens.accessToken, parentId, childId: child._id.toString(), userId: res.body.data.user.id };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted', connectedAt: new Date() });

const as = (parent) => ({
  create: (guests, overrides = {}) =>
    request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${parent.token}`)
      .send({
        hostChildId: parent.childId,
        scheduledDate: isoDay(6),
        time: '09:00',
        activity: 'Vẽ tranh',
        location: { name: 'Công viên', address: '1 Đường A' },
        participants: guests.map((g) => ({ parentId: g.parentId, childId: g.childId })),
        ...overrides,
      }),
  invite: (playdateId, guests) =>
    request(app)
      .post(`/api/v1/playdates/${playdateId}/participants`)
      .set('Authorization', `Bearer ${parent.token}`)
      .send({ participants: guests.map((g) => ({ parentId: g.parentId, childId: g.childId })) }),
  respond: (playdateId, status) =>
    request(app).put(`/api/v1/playdates/${playdateId}/respond`).set('Authorization', `Bearer ${parent.token}`).send({ status }),
  get: (playdateId) => request(app).get(`/api/v1/playdates/${playdateId}`).set('Authorization', `Bearer ${parent.token}`),
  list: (status) => request(app).get(`/api/v1/playdates?status=${status}`).set('Authorization', `Bearer ${parent.token}`),
  cancel: (playdateId) => request(app).patch(`/api/v1/playdates/${playdateId}/cancel`).set('Authorization', `Bearer ${parent.token}`).send({}),
});

describe('Inviting more friends to a playdate (POST /playdates/:id/participants)', () => {
  let host;
  let declined;
  let newcomer;
  let stranger;

  beforeAll(async () => {
    host = await registerParent('host');
    declined = await registerParent('declined');
    newcomer = await registerParent('newcomer');
    stranger = await registerParent('stranger');
    await connect(host, declined);
    await connect(host, newcomer);
  });

  it('shows "awaiting playmates" once every invitee declined, never "confirmed", until a new friend accepts', async () => {
    const created = await as(host).create([declined]);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.displayStatus).toBe('pending');

    await as(declined).respond(id, 'declined');
    expect((await as(host).get(id)).body.data.displayStatus).toBe('awaiting_playmates');
    // The parent who declined sees their own answer
    expect((await as(declined).get(id)).body.data.displayStatus).toBe('declined');
    // Not counted nor listed as confirmed
    const confirmedList = await as(host).list('confirmed');
    expect(confirmedList.body.data.playdates.map((p) => p.id)).not.toContain(id);

    // The host invites another friend: pending again, the creation quota is not used again
    const quotaBefore = (await subscriptionService.getQuotaSummary(host.parentId)).usage.playdatesCreatedThisMonth;
    const invited = await as(host).invite(id, [newcomer]);
    expect(invited.status).toBe(200);
    expect(invited.body.data.displayStatus).toBe('pending');
    expect(invited.body.data.participants.map((p) => [p.parentId, p.status])).toEqual([
      [declined.parentId, 'declined'],
      [newcomer.parentId, 'pending'],
    ]);
    expect((await subscriptionService.getQuotaSummary(host.parentId)).usage.playdatesCreatedThisMonth).toBe(quotaBefore);

    // The new invitee is notified and can answer
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await Notification.countDocuments({ recipientId: newcomer.userId, 'data.playdateId': id })).toBe(1);
    expect((await as(newcomer).respond(id, 'accepted')).status).toBe(200);
    expect((await as(host).get(id)).body.data.displayStatus).toBe('confirmed');
    const confirmedAfter = await as(host).list('confirmed');
    expect(confirmedAfter.body.data.playdates.map((p) => p.id)).toContain(id);
  });

  it('only lets the host invite connected friends who were not invited yet, to an upcoming playdate', async () => {
    const created = await as(host).create([declined], { scheduledDate: isoDay(8) });
    const id = created.body.data.id;

    const byGuest = await as(declined).invite(id, [newcomer]);
    expect(byGuest.status).toBe(403);
    expect(byGuest.body.error.code).toBe('FORBIDDEN_INVITE');

    const notFriend = await as(host).invite(id, [stranger]);
    expect(notFriend.status).toBe(400);
    expect(notFriend.body.error.code).toBe('NOT_CONNECTED_FRIEND');

    // Still pending: cannot be invited twice
    const again = await as(host).invite(id, [declined]);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('ALREADY_INVITED');

    const empty = await as(host).invite(id, []);
    expect(empty.status).toBe(400);

    await as(host).cancel(id);
    const cancelled = await as(host).invite(id, [newcomer]);
    expect(cancelled.status).toBe(400);
    expect(cancelled.body.error.code).toBe('INVALID_PLAYDATE_STATUS');
    expect((await Playdate.findById(id).lean()).participants).toHaveLength(1);
  });

  it('invites several children of a family: one answer, one notification, one participation, one vote', async () => {
    const mHost = await registerParent('multi-host');
    const family = await registerParent('multi-family');
    // Free locks every child past the first one
    await grantPremium(family.parentId);
    const sibling = await Child.create({ parentId: family.parentId, displayName: 'Kid sibling', dateOfBirth: new Date('2021-01-01'), gender: 'boy' });
    const siblingId = sibling._id.toString();
    await connect(mHost, family);
    const both = [family, { parentId: family.parentId, childId: siblingId }];

    const created = await as(mHost).create(both, { scheduledDate: isoDay(18) });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.participants.map((p) => p.childId)).toEqual([family.childId, siblingId]);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await Notification.countDocuments({ recipientId: family.userId, 'data.playdateId': id })).toBe(1);

    const seen = (await as(family).get(id)).body.data;
    expect(seen.myChildIds).toEqual([family.childId, siblingId]);

    // The parent answers once, for both children
    expect((await as(family).respond(id, 'accepted')).status).toBe(200);
    const stored = await Playdate.findById(id).lean();
    expect(stored.participants.map((p) => p.status)).toEqual(['accepted', 'accepted']);
    expect(stored.participants.every((p) => p.quotaConsumedAt)).toBe(true);
    const used = async () => (await subscriptionService.getActionUsage(family.parentId, 'playdateParticipate')).used;
    expect(await used()).toBe(1);

    // One vote per family on a reschedule
    const reschedule = await request(app)
      .post(`/api/v1/playdates/${id}/reschedule`)
      .set('Authorization', `Bearer ${mHost.token}`)
      .send({ newDate: isoDay(19), newStartTime: '10:00' });
    expect(reschedule.status).toBe(201);
    expect(reschedule.body.data.rescheduleRequest.responses).toHaveLength(1);

    // Leaving takes both children out; cancelling afterwards gives nothing back
    const left = await request(app).post(`/api/v1/playdates/${id}/leave`).set('Authorization', `Bearer ${family.token}`);
    expect(left.status).toBe(200);
    expect((await Playdate.findById(id).lean()).participants.map((p) => p.status)).toEqual(['declined', 'declined']);

    // Invited again with one child only: it replaces both entries, the participation stays counted
    const reinvited = await as(mHost).invite(id, [{ parentId: family.parentId, childId: siblingId }]);
    expect(reinvited.status).toBe(200);
    expect(reinvited.body.data.participants.map((p) => [p.childId, p.status])).toEqual([[siblingId, 'pending']]);
    expect((await as(family).respond(id, 'accepted')).status).toBe(200);
    expect(await used()).toBe(1);

    // Host cancels: the family gets its single participation back
    expect((await as(mHost).cancel(id)).status).toBe(200);
    expect(await used()).toBe(0);
  }, 20000);

  it('refuses the answer when one of the invited children is busy at that time', async () => {
    const bHost = await registerParent('busy-host');
    const otherHost = await registerParent('busy-other');
    const family = await registerParent('busy-family');
    await grantPremium(family.parentId);
    const sibling = await Child.create({ parentId: family.parentId, displayName: 'Kid busy', dateOfBirth: new Date('2021-01-01'), gender: 'boy' });
    const siblingEntry = { parentId: family.parentId, childId: sibling._id.toString() };
    await Promise.all([connect(bHost, family), connect(otherHost, family)]);

    const first = await as(otherHost).create([siblingEntry], { scheduledDate: isoDay(20) });
    expect((await as(family).respond(first.body.data.id, 'accepted')).status).toBe(200);

    const second = await as(bHost).create([family, siblingEntry], { scheduledDate: isoDay(20) });
    const res = await as(family).respond(second.body.data.id, 'accepted');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect((await as(family).respond(second.body.data.id, 'declined')).status).toBe(200);
  }, 20000);

  it('offers canLeave only to a family who joined and blocked the host or another joined family', async () => {
    const lHost = await registerParent('leave-host');
    const blocker = await registerParent('leave-blocker');
    const joined = await registerParent('leave-joined');
    const invited = await registerParent('leave-invited');
    await Promise.all([connect(lHost, blocker), connect(lHost, joined), connect(lHost, invited)]);
    const created = await as(lHost).create([blocker, joined, invited], { scheduledDate: isoDay(22) });
    const id = created.body.data.id;
    const canLeave = async (parent) => (await as(parent).get(id)).body.data.canLeave;
    const block = (from, to) =>
      Block.create({ blockerId: from.parentId, blockedId: to.parentId });

    await as(blocker).respond(id, 'accepted');
    await as(joined).respond(id, 'accepted');
    expect(await canLeave(blocker)).toBe(false);

    // A family still invited does not count: who was invited stays private
    await block(blocker, invited);
    expect(await canLeave(blocker)).toBe(false);

    await block(blocker, joined);
    expect(await canLeave(blocker)).toBe(true);
    // Being blocked gives nothing away, and the host cancels instead of leaving
    expect(await canLeave(joined)).toBe(false);
    expect(await canLeave(lHost)).toBe(false);
    // Still invited: the invitation can simply be declined
    expect(await canLeave(invited)).toBe(false);

    const left = await request(app).post(`/api/v1/playdates/${id}/leave`).set('Authorization', `Bearer ${blocker.token}`);
    expect(left.status).toBe(200);
    expect(await canLeave(blocker)).toBe(false);
  }, 20000);

  it('invites again a family who declined or left, back to pending, but never one still in', async () => {
    // Own host: the shared one is kept within its monthly creation quota
    const reHost = await registerParent('rehost');
    const leaver = await registerParent('leaver');
    await Promise.all([connect(reHost, declined), connect(reHost, leaver), connect(reHost, newcomer)]);
    const created = await as(reHost).create([declined, leaver], { scheduledDate: isoDay(14) });
    const id = created.body.data.id;
    await as(declined).respond(id, 'declined');
    await as(leaver).respond(id, 'accepted');
    const left = await request(app).post(`/api/v1/playdates/${id}/leave`).set('Authorization', `Bearer ${leaver.token}`);
    expect(left.status).toBe(200);

    const reinvited = await as(reHost).invite(id, [declined, leaver, newcomer]);
    expect(reinvited.status).toBe(200);
    expect(reinvited.body.data.participants.map((p) => [p.parentId, p.status])).toEqual([
      [declined.parentId, 'pending'],
      [leaver.parentId, 'pending'],
      [newcomer.parentId, 'pending'],
    ]);
    const stored = await Playdate.findById(id).lean();
    expect(stored.participants.every((p) => p.respondedAt === null)).toBe(true);

    // Pending again: a second invitation is refused, and they can answer once more
    const twice = await as(reHost).invite(id, [leaver]);
    expect(twice.body.error.code).toBe('ALREADY_INVITED');
    const usedBefore = (await subscriptionService.getActionUsage(leaver.parentId, 'playdateParticipate')).used;
    expect(usedBefore).toBe(1);
    expect((await as(leaver).respond(id, 'accepted')).status).toBe(200);
    // Same playdate: its participation was already counted on the first accept
    expect((await subscriptionService.getActionUsage(leaver.parentId, 'playdateParticipate')).used).toBe(1);
    // The family who only declined uses a participation when it accepts for the first time
    expect((await as(declined).respond(id, 'accepted')).status).toBe(200);
    expect((await subscriptionService.getActionUsage(declined.parentId, 'playdateParticipate')).used).toBe(1);
  }, 20000);

  it('gives back the participation of families still in when the host cancels, not of those who left', async () => {
    const cHost = await registerParent('cancel-host');
    const stayer = await registerParent('stayer');
    const quitter = await registerParent('quitter');
    await Promise.all([connect(cHost, stayer), connect(cHost, quitter)]);
    const created = await as(cHost).create([stayer, quitter], { scheduledDate: isoDay(16) });
    const id = created.body.data.id;
    await as(stayer).respond(id, 'accepted');
    await as(quitter).respond(id, 'accepted');
    await request(app).post(`/api/v1/playdates/${id}/leave`).set('Authorization', `Bearer ${quitter.token}`);
    const used = async (parent, action) => (await subscriptionService.getActionUsage(parent.parentId, action)).used;
    expect(await used(stayer, 'playdateParticipate')).toBe(1);
    expect(await used(quitter, 'playdateParticipate')).toBe(1);

    expect((await as(cHost).cancel(id)).status).toBe(200);
    expect(await used(stayer, 'playdateParticipate')).toBe(0);
    expect(await used(quitter, 'playdateParticipate')).toBe(1);
    expect(await used(cHost, 'playdateCreate')).toBe(1);
    // A participation used in a past month is not given back on this month's counter
    expect(await subscriptionService.refundQuota(quitter.parentId, 'playdateParticipate', new Date(Date.now() - 40 * DAY))).toBe(false);
    expect(await used(quitter, 'playdateParticipate')).toBe(1);

    // Cancelling twice gives nothing back twice
    expect((await as(cHost).cancel(id)).body.error.code).toBe('ALREADY_CANCELLED');
    expect(await used(stayer, 'playdateParticipate')).toBe(0);
  }, 20000);

  it('shows every invitee to the host only; guests see who joined, themselves and how many are still invited', async () => {
    const joiner = await registerParent('joiner');
    const waiter = await registerParent('waiter');
    await connect(host, joiner);
    await connect(host, waiter);
    const created = await as(host).create([declined, joiner, waiter, newcomer], { scheduledDate: isoDay(12) });
    const id = created.body.data.id;
    await as(declined).respond(id, 'declined');
    await as(joiner).respond(id, 'accepted');

    const seen = async (parent) => {
      const { body } = await as(parent).get(id);
      return { ids: body.data.participants.map((p) => p.parentId).sort(), otherPendingCount: body.data.otherPendingCount };
    };
    const sorted = (...parents) => parents.map((p) => p.parentId).sort();

    expect(await seen(host)).toEqual({ ids: sorted(declined, joiner, waiter, newcomer), otherPendingCount: 0 });
    // Pending: who joined + themselves, the other pending family is only counted, the decline is never shown
    expect(await seen(waiter)).toEqual({ ids: sorted(joiner, waiter), otherPendingCount: 1 });
    expect(await seen(joiner)).toEqual({ ids: sorted(joiner), otherPendingCount: 2 });
    expect(await seen(declined)).toEqual({ ids: sorted(declined, joiner), otherPendingCount: 2 });

    // Same rule in the list
    const list = await as(waiter).list('all');
    const fromList = list.body.data.playdates.find((p) => p.id === id);
    expect(fromList.participants.map((p) => p.parentId).sort()).toEqual(sorted(joiner, waiter));
  });

  it('shows "awaiting playmates" for a playdate created without invitees', async () => {
    // Own host: the shared one used its monthly creation quota
    const soloHost = await registerParent('solo');
    const created = await as(soloHost).create([], { scheduledDate: isoDay(10) });
    expect(created.body.data.displayStatus).toBe('awaiting_playmates');
  });
});
