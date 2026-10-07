import { describe, it, expect, beforeAll } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../src/app.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import chatService from '../../src/modules/chat/chat.service.js';
import { PARTICIPANT_STATUS } from '../../src/modules/playdate/playdate.constants.js';

const registerParent = async (fullName, emailPrefix) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName,
    email: `${emailPrefix}-${Date.now()}@example.com`,
    password: 'Password123!',
  });
  return { token: res.body.data.tokens.accessToken, parentId: res.body.data.parent.id };
};

const setParticipantStatus = (playdateId, parentId, status) =>
  Playdate.updateOne(
    { _id: playdateId, 'participants.parentId': parentId },
    { $set: { 'participants.$.status': status } }
  );

describe('Playdate Group Chat Integration Tests', () => {
  let host;
  let accepted;
  let pending;
  let playdateId = '';
  let conversationId = '';

  beforeAll(async () => {
    host = await registerParent('Me Host', 'pd-host');
    accepted = await registerParent('Me Accepted', 'pd-accepted');
    pending = await registerParent('Me Pending', 'pd-pending');

    const playdate = await Playdate.create({
      hostParentId: host.parentId,
      hostChildId: new mongoose.Types.ObjectId(),
      participants: [
        { parentId: accepted.parentId, childId: new mongoose.Types.ObjectId(), status: PARTICIPANT_STATUS.ACCEPTED },
        { parentId: pending.parentId, childId: new mongoose.Types.ObjectId(), status: PARTICIPANT_STATUS.PENDING },
      ],
      scheduledDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      time: '09:00',
      activity: 'Picnic at the park',
      location: { name: 'Tao Dan Park', address: 'District 1, HCMC' },
    });
    playdateId = playdate._id.toString();
  });

  it('1. creates a single group chat even when host and member open it concurrently', async () => {
    const [resHost, resAccepted] = await Promise.all([
      request(app).get(`/api/v1/chat/playdate/${playdateId}`).set('Authorization', `Bearer ${host.token}`),
      request(app).get(`/api/v1/chat/playdate/${playdateId}`).set('Authorization', `Bearer ${accepted.token}`),
    ]);

    expect(resHost.status).toBe(200);
    expect(resAccepted.status).toBe(200);
    expect(resHost.body.data.id).toBe(resAccepted.body.data.id);
    expect(await Conversation.countDocuments({ playdateId })).toBe(1);

    conversationId = resHost.body.data.id;
    const playdate = await Playdate.findById(playdateId).lean();
    expect(playdate.chatConversationId.toString()).toBe(conversationId);
  });

  it('2. returns playdate details (host + participants) and only host & accepted members', async () => {
    const res = await request(app)
      .get(`/api/v1/chat/playdate/${playdateId}`)
      .set('Authorization', `Bearer ${accepted.token}`);

    expect(res.body.data.type).toBe('playdate');
    expect(res.body.data.participants.map((p) => p.id).sort()).toEqual(
      [host.parentId, accepted.parentId].sort()
    );
    expect(res.body.data.playdate.host.id).toBe(host.parentId);
    expect(res.body.data.playdate.participants).toHaveLength(2);
    expect(res.body.data.playdate.location.name).toBe('Tao Dan Park');
  });

  it('3. GET /conversations/:id also returns playdate details for the event panel', async () => {
    const res = await request(app)
      .get(`/api/v1/chat/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${host.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.playdate.host.id).toBe(host.parentId);
    expect(res.body.data.playdate.participants).toHaveLength(2);
  });

  it('4. rejects a pending participant', async () => {
    const res = await request(app)
      .get(`/api/v1/chat/playdate/${playdateId}`)
      .set('Authorization', `Bearer ${pending.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_PLAYDATE_CHAT_ACCESS');
  });

  it('5. delivers a group message and counts it as unread for the other members', async () => {
    const sendRes = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accepted.token}`)
      .send({ content: 'See you at the park!' });
    expect(sendRes.status).toBe(201);

    const listRes = await request(app)
      .get('/api/v1/chat/conversations?type=playdate')
      .set('Authorization', `Bearer ${host.token}`);
    const groupChat = listRes.body.data.find((c) => c.id === conversationId);
    expect(groupChat.unreadCount).toBe(1);
    expect(groupChat.lastMessage.content).toBe('See you at the park!');
  });

  it('6. syncPlaydateConversation removes declined members and adds newly accepted ones', async () => {
    await setParticipantStatus(playdateId, accepted.parentId, PARTICIPANT_STATUS.DECLINED);
    await setParticipantStatus(playdateId, pending.parentId, PARTICIPANT_STATUS.ACCEPTED);

    const conversation = await chatService.syncPlaydateConversation(playdateId);
    expect(conversation._id.toString()).toBe(conversationId);
    expect(conversation.participants.map((p) => p._id.toString()).sort()).toEqual(
      [host.parentId, pending.parentId].sort()
    );

    const declinedRes = await request(app)
      .get(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${accepted.token}`);
    expect(declinedRes.status).toBe(403);

    const newMemberRes = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${pending.token}`)
      .send({ content: 'Thanks for having us!' });
    expect(newMemberRes.status).toBe(201);
  });

  it('7. POST /conversations/:id/read resets the unread counter', async () => {
    const res = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(res.status).toBe(200);

    const listRes = await request(app)
      .get('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${host.token}`);
    expect(listRes.body.data.find((c) => c.id === conversationId).unreadCount).toBe(0);
  });
});
