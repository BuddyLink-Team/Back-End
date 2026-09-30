import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';

describe('Chat Module Integration Tests (TASK-BE-10)', () => {
  let parentTokenA = '';
  let parentIdA = '';
  let parentTokenB = '';
  let parentIdB = '';
  let conversationId = '';

  beforeAll(async () => {
    // 1. Register Parent A
    const resA = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Me Lan Anh',
      email: `lananh-${Date.now()}@example.com`,
      password: 'Password123!',
    });
    parentTokenA = resA.body.data.tokens.accessToken;
    parentIdA = resA.body.data.parent.id;

    // 2. Register Parent B
    const resB = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Me Thu Ha',
      email: `thuha-${Date.now()}@example.com`,
      password: 'Password123!',
    });
    parentTokenB = resB.body.data.tokens.accessToken;
    parentIdB = resB.body.data.parent.id;
  });

  it('1. POST /api/v1/chat/conversations: should create a direct conversation between Parent A and Parent B', async () => {
    const res = await request(app)
      .post('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ targetParentId: parentIdB });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('direct');
    expect(res.body.data.participants).toHaveLength(2);
    expect(res.body.data.partner.id).toBe(parentIdB);

    conversationId = res.body.data.id;
  });

  it('2. GET /api/v1/chat/conversations: should return conversations list with unread counter', async () => {
    const res = await request(app)
      .get('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].id).toBe(conversationId);
  });

  it('3. POST /api/v1/chat/conversations/:id/messages: Parent A sends a message', async () => {
    const res = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({
        content: 'Chao me Thu Ha! Cuoi tuan nay cho be giao luu nhe!',
        type: 'text',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('Chao me Thu Ha! Cuoi tuan nay cho be giao luu nhe!');
    expect(res.body.data.isMine).toBe(true);
    expect(res.body.data.senderId).toBe(parentIdA);
  });

  it('4. GET /api/v1/chat/conversations/:id/messages: Parent B receives messages', async () => {
    const res = await request(app)
      .get(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].isMine).toBe(false);
  });

  it('5. POST /api/v1/chat/conversations/:id/read: Parent B marks conversation as read', async () => {
    const res = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${parentTokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.conversationId).toBe(conversationId);
  });

  it('6. POST /api/v1/chat/upload: should upload an image attachment via Cloud Storage adapter', async () => {
    const buffer = Buffer.from('fake-image-content-for-testing');
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .attach('image', buffer, 'test-baby-play.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mediaUrl).toBeDefined();
  });

  describe('Playdate Group Chat & Permissions (TASK-BE-11)', () => {
    let parentTokenC = '';
    let parentIdC = '';
    let playdateId = '';
    let playdateConversationId = '';

    beforeAll(async () => {
      // Register Parent C (Pending participant)
      const resC = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Bo Tuan Minh',
        email: `tuanminh-${Date.now()}@example.com`,
        password: 'Password123!',
      });
      parentTokenC = resC.body.data.tokens.accessToken;
      parentIdC = resC.body.data.parent.id;

      // Create Children for Playdate
      const Child = (await import('../../src/modules/child/child.model.js')).default;
      const Playdate = (await import('../../src/modules/playdate/playdate.model.js')).default;
      const { PARTICIPANT_STATUS } = await import('../../src/modules/playdate/playdate.constants.js');

      const childA = await Child.create({
        parentId: parentIdA,
        displayName: 'Be Min',
        dateOfBirth: new Date('2021-05-10'),
        gender: 'girl',
        interests: ['Painting', 'Lego'],
      });

      const childB = await Child.create({
        parentId: parentIdB,
        displayName: 'Be Bo',
        dateOfBirth: new Date('2020-08-15'),
        gender: 'boy',
        interests: ['Football', 'Cars'],
      });

      const childC = await Child.create({
        parentId: parentIdC,
        displayName: 'Be Sam',
        dateOfBirth: new Date('2021-01-20'),
        gender: 'girl',
        interests: ['Reading'],
      });

      // Create Playdate with Host A, Accepted B, Pending C
      const playdate = await Playdate.create({
        hostParentId: parentIdA,
        hostChildId: childA._id,
        scheduledDate: new Date(Date.now() + 86400000),
        time: '15:30',
        activity: 'Buoi hen to mau & choi cat',
        location: {
          name: 'Tiem Ca phe Cat Mam Xanh',
          address: 'So 12 Duong So 47, P. Thao Dien, TP. Thu Duc',
        },
        participants: [
          {
            parentId: parentIdB,
            childId: childB._id,
            status: PARTICIPANT_STATUS.ACCEPTED,
          },
          {
            parentId: parentIdC,
            childId: childC._id,
            status: PARTICIPANT_STATUS.PENDING, // Not accepted yet
          },
        ],
      });

      playdateId = playdate._id.toString();
    });

    it('7. GET /api/v1/chat/playdate/:playdateId: Host Parent A can access and initialize playdate chat room', async () => {
      const res = await request(app)
        .get(`/api/v1/chat/playdate/${playdateId}`)
        .set('Authorization', `Bearer ${parentTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('playdate');
      expect(res.body.data.playdate).toBeDefined();
      expect(res.body.data.playdate.title).toBe('Buoi hen to mau & choi cat');
      expect(res.body.data.playdate.participants).toHaveLength(2);

      playdateConversationId = res.body.data.id;
    });

    it('8. GET /api/v1/chat/playdate/:playdateId: Accepted Parent B is AUTHORIZED to join the chat', async () => {
      const res = await request(app)
        .get(`/api/v1/chat/playdate/${playdateId}`)
        .set('Authorization', `Bearer ${parentTokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(playdateConversationId);
    });

    it('9. GET /api/v1/chat/playdate/:playdateId: Pending Parent C is FORBIDDEN (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/chat/playdate/${playdateId}`)
        .set('Authorization', `Bearer ${parentTokenC}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN_PLAYDATE_CHAT_ACCESS');
    });

    it('10. POST /api/v1/chat/conversations/:id/messages: Pending Parent C cannot send messages to Playdate chat (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/chat/conversations/${playdateConversationId}/messages`)
        .set('Authorization', `Bearer ${parentTokenC}`)
        .send({
          content: 'Xin chao, cho toi tham gia voi!',
          type: 'text',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
