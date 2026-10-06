import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import storageAdapter from '../../src/integrations/storage/storage.adapter.js';
import { PNG_BUFFER } from '../helpers/imageHelper.js';
import Connection from '../../src/modules/connection/connection.model.js';
import { CONNECTION_STATUS } from '../../src/modules/connection/connection.constants.js';
import parentService from '../../src/modules/parent/parent.service.js';
import Message from '../../src/modules/chat/message.model.js';
import { registerChatSocket } from '../../src/sockets/chat.socket.js';
import { SOCKET_EVENTS } from '../../src/modules/chat/chat.constants.js';

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

  it('12. Message pagination: should support before (message id cursor) and limit query parameters', async () => {
    // Post a second message
    const msg2Res = await request(app)
      .post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${parentTokenB}`)
      .send({ content: 'Tin nhắn thứ hai' });
    expect(msg2Res.status).toBe(201);
    const msg2Id = msg2Res.body.data.id;

    // Fetch messages older than msg2
    const paginatedRes = await request(app)
      .get(`/api/v1/chat/conversations/${conversationId}/messages?limit=1&before=${msg2Id}`)
      .set('Authorization', `Bearer ${parentTokenA}`);

    expect(paginatedRes.status).toBe(200);
    expect(paginatedRes.body.data.length).toBe(1);
    expect(paginatedRes.body.data[0].id).not.toBe(msg2Id);
    expect(paginatedRes.body.data[0].id < msg2Id).toBe(true);

    // A date string is no longer a valid cursor
    const invalidCursorRes = await request(app)
      .get(`/api/v1/chat/conversations/${conversationId}/messages?before=${encodeURIComponent(new Date().toISOString())}`)
      .set('Authorization', `Bearer ${parentTokenA}`);
    expect(invalidCursorRes.status).toBe(400);
  });

  it('13. mediaUrl ownership: should only accept images uploaded through our own Cloud Storage', async () => {
    const sendWithMedia = (mediaUrl) =>
      request(app)
        .post(`/api/v1/chat/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${parentTokenA}`)
        .send({ type: 'image', mediaUrl });

    // External https image (tracking pixel / phishing) is rejected
    const externalRes = await sendWithMedia('https://evil.example.com/pixel.png');
    expect(externalRes.status).toBe(400);
    expect(externalRes.body.error.code).toBe('INVALID_MEDIA_URL');

    // Image from our Cloudinary account is accepted
    const originalCloudName = storageAdapter.cloudName;
    storageAdapter.cloudName = 'test-cloud';
    try {
      const ownedRes = await sendWithMedia('https://res.cloudinary.com/test-cloud/image/upload/v1/buddylink/chat/play.png');
      expect(ownedRes.status).toBe(201);
      expect(ownedRes.body.data.type).toBe('image');

      // Same path on another Cloudinary account is rejected
      const otherCloudRes = await sendWithMedia('https://res.cloudinary.com/other-cloud/image/upload/v1/x.png');
      expect(otherCloudRes.status).toBe(400);
    } finally {
      storageAdapter.cloudName = originalCloudName;
    }

    // Inline data URL returned by the non-production fallback upload is accepted
    const dataUrlRes = await sendWithMedia(`data:image/png;base64,${PNG_BUFFER.toString('base64')}`);
    expect(dataUrlRes.status).toBe(201);
  });

  it('14. Safety validation: should validate block/report payloads and reject self-report', async () => {
    const invalidBlockRes = await request(app)
      .post('/api/v1/safety/block')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ blockedId: 'not-an-id' });
    expect(invalidBlockRes.status).toBe(400);
    expect(invalidBlockRes.body.error.code).toBe('VALIDATION_ERROR');

    const longReasonRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ reportedUserId: parentIdB, reason: 'x'.repeat(201) });
    expect(longReasonRes.status).toBe(400);

    const invalidTargetTypeRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ reportedUserId: parentIdB, targetType: 'anything', reason: 'Spam' });
    expect(invalidTargetTypeRes.status).toBe(400);

    const selfReportRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ reportedUserId: parentIdA, targetType: 'user', reason: 'Spam' });
    expect(selfReportRes.status).toBe(400);
    expect(selfReportRes.body.error.code).toBe('SELF_REPORT_NOT_ALLOWED');

    const validReportRes = await request(app)
      .post('/api/v1/safety/report')
      .set('Authorization', `Bearer ${parentTokenA}`)
      .send({ reportedUserId: parentIdB, targetType: 'user', reason: 'Spam', description: 'Gửi tin quảng cáo' });
    expect(validReportRes.status).toBe(201);
  });

  describe('Socket send_message handler', () => {
    // Minimal socket/io stubs that capture registered handlers and emitted events
    const createIoStub = () => {
      const emitted = [];
      return {
        emitted,
        to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
      };
    };

    const createSocketStub = (parent) => {
      const handlers = {};
      return {
        id: 'test-socket',
        parent,
        parentId: parent?._id.toString(),
        rooms: new Set(),
        handlers,
        on: (event, handler) => {
          handlers[event] = handler;
        },
        join: () => {},
        leave: () => {},
        emit: () => {},
        to: () => ({ emit: () => {} }),
      };
    };

    it('15. should echo tempId to the sender only (ack + own room) without storing it', async () => {
      const parentA = await parentService.getParentById(parentIdA);
      const io = createIoStub();
      const socket = createSocketStub(parentA);
      registerChatSocket(io, socket);

      let ack;
      await socket.handlers[SOCKET_EVENTS.SEND_MESSAGE](
        { conversationId, content: 'Tin gui qua socket', tempId: 'tmp-123' },
        (response) => {
          ack = response;
        },
      );

      expect(ack.success).toBe(true);
      expect(ack.data.tempId).toBe('tmp-123');
      expect(ack.data.isMine).toBe(true);

      const senderEcho = io.emitted.find(
        ({ room, event }) => room === `parent:${parentIdA}` && event === SOCKET_EVENTS.RECEIVE_MESSAGE,
      );
      const recipientEcho = io.emitted.find(
        ({ room, event }) => room === `parent:${parentIdB}` && event === SOCKET_EVENTS.RECEIVE_MESSAGE,
      );
      expect(senderEcho.payload.tempId).toBe('tmp-123');
      expect(recipientEcho.payload.tempId).toBeUndefined();

      const storedMessage = await Message.findById(ack.data.id).lean();
      expect(storedMessage.tempId).toBeUndefined();
    });

    it('16. should reject non-parent sockets with PARENT_REQUIRED', async () => {
      const socket = createSocketStub(null);
      registerChatSocket(createIoStub(), socket);

      let ack;
      await socket.handlers[SOCKET_EVENTS.SEND_MESSAGE](
        { conversationId, content: 'Admin khong chat duoc' },
        (response) => {
          ack = response;
        },
      );

      expect(ack.success).toBe(false);
      expect(ack.code).toBe('PARENT_REQUIRED');
    });
  });
});

