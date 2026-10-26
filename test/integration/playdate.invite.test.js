import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import subscriptionService from '../../src/modules/subscription/subscription.service.js';

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
