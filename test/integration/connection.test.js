import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';

const register = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Parent ${label}`,
    email: `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    password: 'Password123!',
  });
  return { token: res.body.data.tokens.accessToken, parentId: res.body.data.parent.id };
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const sendRequest = (from, to) =>
  request(app).post('/api/v1/connections').set(auth(from.token)).send({ recipientId: to.parentId });

describe('Connections management (/api/v1/connections)', () => {
  let alice;
  let bob;
  let carol;
  let dave;

  beforeAll(async () => {
    [alice, bob, carol, dave] = await Promise.all([
      register('alice'),
      register('bob'),
      register('carol'),
      register('dave'),
    ]);
    // A precise home address that must never be shared with other parents
    await Parent.updateOne(
      { _id: alice.parentId },
      {
        $set: {
          location: {
            address: '12 Nguyen Van Linh, Hai Chau',
            area: 'Hai Chau',
            city: 'Da Nang',
            coordinates: { type: 'Point', coordinates: [108.22, 16.06] },
          },
        },
      }
    );
  });

  it('sends a request, lists it on both sides and lets only the recipient accept it', async () => {
    const sendRes = await sendRequest(alice, bob);
    expect(sendRes.status).toBe(201);
    expect(sendRes.body.data.isNew).toBe(true);
    const connectionId = sendRes.body.data.connection.id;

    // Sending again returns the existing request instead of a duplicate
    const againRes = await sendRequest(alice, bob);
    expect(againRes.status).toBe(200);
    expect(againRes.body.data.isNew).toBe(false);

    const incomingRes = await request(app)
      .get('/api/v1/connections?status=pending&direction=incoming')
      .set(auth(bob.token));
    expect(incomingRes.status).toBe(200);
    expect(incomingRes.body.data.items).toHaveLength(1);
    const incoming = incomingRes.body.data.items[0];
    expect(incoming.direction).toBe('incoming');
    expect(incoming.partner.id).toBe(alice.parentId);
    expect(incoming.partner).toHaveProperty('child');
    // Only the area / city is shared, never the street address or the coordinates
    expect(incoming.partner.location).toEqual({ area: 'Hai Chau', city: 'Da Nang' });
    expect(JSON.stringify(incoming)).not.toContain('Nguyen Van Linh');

    const outgoingRes = await request(app)
      .get('/api/v1/connections?status=pending&direction=outgoing')
      .set(auth(alice.token));
    expect(outgoingRes.body.data.items).toHaveLength(1);
    expect(outgoingRes.body.data.items[0].direction).toBe('outgoing');

    // The requester cannot accept its own request
    const forbiddenRes = await request(app).patch(`/api/v1/connections/${connectionId}/accept`).set(auth(alice.token));
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error.code).toBe('UNAUTHORIZED_ACTION');

    const acceptRes = await request(app).patch(`/api/v1/connections/${connectionId}/accept`).set(auth(bob.token));
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.data.status).toBe('accepted');

    const acceptedRes = await request(app).get('/api/v1/connections?status=accepted').set(auth(alice.token));
    expect(acceptedRes.body.data.items).toHaveLength(1);
    expect(acceptedRes.body.data.items[0].partner.id).toBe(bob.parentId);

    // Accepting twice is rejected
    const twiceRes = await request(app).patch(`/api/v1/connections/${connectionId}/accept`).set(auth(bob.token));
    expect(twiceRes.status).toBe(409);
    expect(twiceRes.body.error.code).toBe('INVALID_CONNECTION_STATE');
  });

  it('stops the direct chat once the connection is removed', async () => {
    const chatRes = await request(app)
      .post('/api/v1/chat/conversations')
      .set(auth(alice.token))
      .send({ targetParentId: bob.parentId });
    expect([200, 201]).toContain(chatRes.status);
    const conversationId = chatRes.body.data.id;

    const firstMessage = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set(auth(alice.token))
      .send({ content: 'Hello Bob', type: 'text' });
    expect(firstMessage.status).toBe(201);

    const acceptedRes = await request(app).get('/api/v1/connections?status=accepted').set(auth(bob.token));
    const removeRes = await request(app)
      .delete(`/api/v1/connections/${acceptedRes.body.data.items[0].id}`)
      .set(auth(bob.token));
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.data.status).toBe('removed');

    const afterRemoval = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set(auth(alice.token))
      .send({ content: 'Still there?', type: 'text' });
    expect(afterRemoval.status).toBe(403);
    expect(afterRemoval.body.error.code).toBe('CONNECTION_REQUIRED');
  });

  it('lets the requester cancel a sent request and the recipient decline one', async () => {
    const sendRes = await sendRequest(carol, alice);
    const cancelRes = await request(app)
      .delete(`/api/v1/connections/${sendRes.body.data.connection.id}`)
      .set(auth(carol.token));
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('removed');

    const resendRes = await sendRequest(carol, alice);
    expect(resendRes.status).toBe(201);
    const declineRes = await request(app)
      .patch(`/api/v1/connections/${resendRes.body.data.connection.id}/decline`)
      .set(auth(alice.token));
    expect(declineRes.status).toBe(200);
    expect(declineRes.body.data.status).toBe('declined');
  });

  it('hides blocked parents and forbids connecting with them until they are unblocked', async () => {
    const pendingRes = await sendRequest(dave, carol);
    const connectionId = pendingRes.body.data.connection.id;
    await request(app).post('/api/v1/safety/block').set(auth(dave.token)).send({ targetParentId: carol.parentId });

    const incomingRes = await request(app)
      .get('/api/v1/connections?status=pending&direction=incoming')
      .set(auth(carol.token));
    expect(incomingRes.body.data.items.find((c) => c.id === connectionId)).toBeUndefined();

    const acceptRes = await request(app).patch(`/api/v1/connections/${connectionId}/accept`).set(auth(carol.token));
    expect(acceptRes.status).toBe(403);
    expect(acceptRes.body.error.code).toBe('BLOCKED_INTERACTION');

    const blockedRes = await sendRequest(carol, dave);
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.body.error.code).toBe('BLOCKED_INTERACTION');

    // Unblocking shows the request again
    await request(app).delete(`/api/v1/safety/block/${carol.parentId}`).set(auth(dave.token));
    const afterUnblock = await request(app)
      .get('/api/v1/connections?status=pending&direction=incoming')
      .set(auth(carol.token));
    expect(afterUnblock.body.data.items.find((c) => c.id === connectionId)).toBeDefined();
  });

  it('paginates and searches the connections by parent or child name', async () => {
    const host = await register('pager');
    const senders = await Promise.all([register('zeta-one'), register('zeta-two'), register('omega')]);
    await Promise.all(senders.map((sender) => sendRequest(sender, host)));

    const pageOne = await request(app)
      .get('/api/v1/connections?status=pending&direction=incoming&page=1&limit=2')
      .set(auth(host.token));
    expect(pageOne.body.data.items).toHaveLength(2);
    expect(pageOne.body.data.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const pageTwo = await request(app)
      .get('/api/v1/connections?status=pending&direction=incoming&page=2&limit=2')
      .set(auth(host.token));
    expect(pageTwo.body.data.items).toHaveLength(1);

    const searchRes = await request(app)
      .get('/api/v1/connections?status=pending&direction=incoming&search=zeta')
      .set(auth(host.token));
    expect(searchRes.body.data.pagination.total).toBe(2);
    expect(searchRes.body.data.items.every((item) => item.partner.fullName.includes('zeta'))).toBe(true);

    // Invitable friends: accepted connections only, narrowed by name
    await Promise.all(
      pageOne.body.data.items.concat(pageTwo.body.data.items).map((item) =>
        request(app).patch(`/api/v1/connections/${item.id}/accept`).set(auth(host.token))
      )
    );
    const friendsRes = await request(app).get('/api/v1/playdates/friends?search=zeta&limit=1').set(auth(host.token));
    expect(friendsRes.status).toBe(200);
    expect(friendsRes.body.data).toHaveLength(1);
    expect(friendsRes.body.data[0].fullName).toContain('zeta');
  });

  it('rejects a request to yourself and an invalid id', async () => {
    const selfRes = await sendRequest(alice, alice);
    expect(selfRes.status).toBe(400);
    expect(selfRes.body.error.code).toBe('SELF_CONNECTION_NOT_ALLOWED');

    const invalidRes = await request(app).patch('/api/v1/connections/not-an-id/accept').set(auth(alice.token));
    expect(invalidRes.status).toBe(400);
  });
});
