import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import storageAdapter from '../../src/integrations/storage/storage.adapter.js';
import { PNG_BUFFER } from '../helpers/imageHelper.js';
import Connection from '../../src/modules/connection/connection.model.js';
import { CONNECTION_STATUS } from '../../src/modules/connection/connection.constants.js';

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

    // 3. Establish accepted connection between Parent A and Parent B
    await Connection.create({
      parents: [parentIdA, parentIdB],
      pairKey: [parentIdA, parentIdB].sort().join('_'),
      requesterId: parentIdA,
      recipientId: parentIdB,
      status: CONNECTION_STATUS.ACCEPTED,
      connectedAt: new Date(),
    });
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
    // Mock Cloud Storage upload to prevent real external API call in test
    const uploadSpy = jest
      .spyOn(storageAdapter, 'uploadImage')
      .mockResolvedValueOnce({
        url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/buddylink/chat/play.png',
        publicId: 'buddylink/chat/play',
      });

    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .attach('image', PNG_BUFFER, 'test-baby-play.png');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mediaUrl).toBe('https://res.cloudinary.com/test-cloud/image/upload/v1/buddylink/chat/play.png');
    expect(uploadSpy).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ folder: 'buddylink/chat', mimetype: 'image/png' }));

    uploadSpy.mockRestore();
  });

  it('7. POST /api/v1/chat/upload: should reject a non-image file renamed to .png', async () => {
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .attach('image', Buffer.from('fake-image-content-for-testing'), 'test-baby-play.png');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('8. Safety block: should prevent sending messages when one party is blocked', async () => {
    // Parent B blocks Parent A
    const blockRes = await request(app)
      .post('/api/v1/safety/block')
      .set('Authorization', `Bearer ${parentTokenB}`)
      .send({ blockedId: parentIdA, reason: 'Quay ray' });

    expect(blockRes.status).toBe(200);
    expect(blockRes.body.success).toBe(true);

    // Parent A tries to send a message in the conversation
    const sendRes = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ content: 'Minh noi chuyen duoc khong?' });

    expect(sendRes.status).toBe(403);
    expect(sendRes.body.error.code).toBe('USER_BLOCKED');

    // Parent A tries to create a new direct conversation
    const createRes = await request(app)
      .post('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ targetParentId: parentIdB });

    expect(createRes.status).toBe(403);
    expect(createRes.body.error.code).toBe('USER_BLOCKED');

    // Parent B unblocks Parent A
    const unblockRes = await request(app)
      .delete(`/api/v1/safety/block/${parentIdA}`)
      .set('Authorization', `Bearer ${parentTokenB}`);

    expect(unblockRes.status).toBe(200);
    expect(unblockRes.body.success).toBe(true);

    // Message sending works again
    const reSendRes = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ content: 'Da mo chan, minh tro chuyen tiep nhe!' });

    expect(reSendRes.status).toBe(201);
    expect(reSendRes.body.success).toBe(true);
  });

  it('9. Connection requirement: should reject creating direct chat if parents are not connected', async () => {
    // Register Parent C (not connected to anyone)
    const resC = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Me Huong Giang',
      email: `huonggiang-${Date.now()}@example.com`,
      password: 'Password123!',
    });
    const parentTokenC = resC.body.data.tokens.accessToken;

    const chatRes = await request(app)
      .post('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${parentTokenC}`)
      .send({ targetParentId: parentIdA });

    expect(chatRes.status).toBe(403);
    expect(chatRes.body.error.code).toBe('CONNECTION_REQUIRED');
  });

  it('10. Strict payload validation: should reject type system, invalid mediaUrl, and excessive content', async () => {
    // 1. type: system spoofing
    const resType = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ content: 'Fake system message', type: 'system' });
    expect(resType.status).toBe(400);

    // 2. invalid mediaUrl
    const resUrl = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ content: 'Check image', mediaUrl: 'javascript:alert(1)' });
    expect(resUrl.status).toBe(400);

    // 3. content > 5000 characters
    const longContent = 'A'.repeat(5001);
    const resLen = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ content: longContent });
    expect(resLen.status).toBe(400);
  });

  it('11. Direct conversation uniqueness: should enforce pairKey and return identical conversation on concurrent/repeated creation', async () => {
    // Both Parent A and Parent B concurrently request creating direct chat
    const [resFromA, resFromB] = await Promise.all([
      request(app)
        .post('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${parentTokenA}`)
        .send({ targetParentId: parentIdB }),
      request(app)
        .post('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${parentTokenB}`)
        .send({ targetParentId: parentIdA }),
    ]);

    expect(resFromA.status).toBe(200);
    expect(resFromB.status).toBe(200);
    expect(resFromA.body.data.id).toBe(conversationId);
    expect(resFromB.body.data.id).toBe(conversationId);
  });

  it('12. Message pagination: should support before and limit query parameters', async () => {
    // Post a second message
    const msg2Res = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenB}`)
      .send({ content: 'Tin nhắn thứ hai' });
    expect(msg2Res.status).toBe(201);
    const msg2CreatedAt = msg2Res.body.data.createdAt;

    // Fetch messages before msg2
    const paginatedRes = await request(app)
      .get(`/api/v1/chat/conversations/${conversationId}/messages?limit=1&before=${encodeURIComponent(msg2CreatedAt)}`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(paginatedRes.status).toBe(200);
    expect(paginatedRes.body.data.length).toBe(1);
    expect(new Date(paginatedRes.body.data[0].createdAt).getTime()).toBeLessThan(new Date(msg2CreatedAt).getTime());
  });
});

