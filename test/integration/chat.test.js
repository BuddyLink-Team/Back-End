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
});
