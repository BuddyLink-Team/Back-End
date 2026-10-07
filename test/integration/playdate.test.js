import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import UsageQuota from '../../src/modules/subscription/usage-quota.model.js';

describe('Playdate Management Integration Flow', () => {
  let hostToken = '';
  let guestToken = '';
  let hostParentId = '';
  let guestParentId = '';
  let hostChildId = '';
  let createdPlaydateId = '';
  let invitedPlaydateId = '';

  beforeAll(async () => {
    // Register host parent
    const hostRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Host Mother',
      email: `host-${Date.now()}@test.com`,
      password: 'Password123!',
    });
    hostToken = hostRes.body.data.tokens.accessToken;
    hostParentId = hostRes.body.data.parent.id;

    // Create child for host
    const childRes = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        displayName: 'Bé Bi',
        dateOfBirth: '2020-05-15',
        gender: 'boy',
        interests: ['lego', 'painting'],
      });
    hostChildId = childRes.body.data.id;

    // Register guest parent
    const guestRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Guest Father',
      email: `guest-${Date.now()}@test.com`,
      password: 'Password123!',
    });
    guestToken = guestRes.body.data.tokens.accessToken;
    guestParentId = guestRes.body.data.parent.id;
  });

  it('1. GET /api/v1/playdates: should return empty list initially with counts', async () => {
    const res = await request(app)
      .get('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.playdates).toEqual([]);
    expect(res.body.data.counts.all).toBe(0);
  });

  it('2. POST /api/v1/playdates: should create a new playdate in upcoming status', async () => {
    const scheduledDate = new Date(Date.now() + 86400000).toISOString();
    const res = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        hostChildId,
        scheduledDate,
        time: '15:00 - 17:00',
        activity: 'Buổi chơi Lego & Công viên',
        location: {
          name: 'Công viên Cầu Ánh Sao',
          address: 'Quận 7, TP. Hồ Chí Minh',
        },
        note: 'Bé nhớ mang nón và bình nước nhé',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.activity).toBe('Buổi chơi Lego & Công viên');
    expect(res.body.data.status).toBe('upcoming');
    expect(res.body.data.isHost).toBe(true);
    createdPlaydateId = res.body.data.id;
  });

  it('3. GET /api/v1/playdates?status=upcoming: should retrieve the upcoming playdate', async () => {
    const res = await request(app)
      .get('/api/v1/playdates?status=upcoming')
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.playdates.length).toBe(1);
    expect(res.body.data.playdates[0].id).toBe(createdPlaydateId);
    expect(res.body.data.counts.all).toBe(1);
  });

  it('4. PATCH /api/v1/playdates/:id/complete: should fail if caller is not the host (403)', async () => {
    const res = await request(app)
      .patch(`/api/v1/playdates/${createdPlaydateId}/complete`)
      .set('Authorization', `Bearer ${guestToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('4b. PATCH /api/v1/playdates/:id/complete: should reject completing if scheduled time has not arrived (400)', async () => {
    const res = await request(app)
      .patch(`/api/v1/playdates/${createdPlaydateId}/complete`)
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CANNOT_COMPLETE_YET');
  });

  it('5. PATCH /api/v1/playdates/:id/complete: should succeed when host completes it after scheduled time', async () => {
    // Update scheduledDate to past so CANNOT_COMPLETE_YET check passes
    await Playdate.findByIdAndUpdate(createdPlaydateId, {
      scheduledDate: new Date(Date.now() - 3600000),
      time: '08:00',
    });

    const res = await request(app)
      .patch(`/api/v1/playdates/${createdPlaydateId}/complete`)
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.displayStatus).toBe('completed');
    expect(res.body.data.completedAt).toBeDefined();
  });

  it('6. GET /api/v1/playdates?status=completed: should list completed playdates', async () => {
    const res = await request(app)
      .get('/api/v1/playdates?status=completed')
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.playdates.length).toBe(1);
    expect(res.body.data.playdates[0].status).toBe('completed');
    expect(res.body.data.counts.completed).toBe(1);
  });

  it('7. POST /api/v1/playdates: should reject inviting parents who are not accepted friends (400)', async () => {
    // Guest parent is not connected as friend yet
    const guestChildRes = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        displayName: 'Bé Bông',
        dateOfBirth: '2021-03-10',
        gender: 'girl',
        interests: ['drawing'],
      });
    const guestChildId = guestChildRes.body.data.id;

    const res = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        hostChildId,
        scheduledDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        time: '09:00 - 11:00',
        activity: 'Vẽ tranh ngoài trời',
        location: {
          name: 'Công viên Tao Đàn',
          address: 'Quận 1, TP. Hồ Chí Minh',
        },
        participants: [
          { parentId: guestParentId, childId: guestChildId },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_CONNECTED_FRIEND');
  });

  it('8. GET /api/v1/playdates/friends: should return friends and children once connection is accepted', async () => {
    // Create accepted friendship connection
    const Connection = (await import('../../src/modules/connection/connection.model.js')).default;
    await Connection.create({
      parents: [hostParentId, guestParentId],
      requesterId: hostParentId,
      recipientId: guestParentId,
      status: 'accepted',
      connectedAt: new Date(),
    });

    const res = await request(app)
      .get('/api/v1/playdates/friends')
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(guestParentId);
    expect(res.body.data[0].children.length).toBeGreaterThanOrEqual(1);
  });

  it('9. POST /api/v1/playdates: should create playdate with friend and auto-generate chat room', async () => {
    const Child = (await import('../../src/modules/child/child.model.js')).default;
    const guestChild = await Child.findOne({ parentId: guestParentId, isArchived: false });

    const res = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        hostChildId,
        scheduledDate: new Date(Date.now() + 86400000 * 3).toISOString(),
        time: '14:00 - 16:30',
        activity: 'Giao lưu vẽ tranh nghệ thuật',
        location: {
          name: 'Bảo tàng Mỹ thuật',
          address: 'Quận 1, TP. Hồ Chí Minh',
        },
        participants: [
          { parentId: guestParentId, childId: guestChild._id.toString() },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.chatConversationId).toBeDefined();
    expect(res.body.data.chatConversationId).not.toBeNull();
    invitedPlaydateId = res.body.data.id;

    // Verify conversation document in MongoDB
    const Conversation = (await import('../../src/modules/chat/conversation.model.js')).default;
    const conversation = await Conversation.findById(res.body.data.chatConversationId);
    expect(conversation).toBeDefined();
    expect(conversation.type).toBe('playdate');
    expect(conversation.playdateId.toString()).toBe(res.body.data.id);
    // Group chat members are the host and accepted participants: the invitee joins after accepting
    expect(conversation.participants.map((p) => p.toString())).toContain(hostParentId);
    expect(conversation.participants.map((p) => p.toString())).not.toContain(guestParentId);
  });

  it('10. POST /api/v1/playdates: should enforce 3 playdates/month quota for Free tier', async () => {
    // Free host currently has 2 playdates created (test 2 and test 9)
    // 3rd playdate creation should succeed
    const res3 = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        hostChildId,
        scheduledDate: new Date(Date.now() + 86400000 * 4).toISOString(),
        time: '16:00 - 18:00',
        activity: 'Chạy xe đạp công viên',
        location: {
          name: 'Công viên Sala',
          address: 'TP. Thủ Đức, TP. Hồ Chí Minh',
        },
      });

    expect(res3.status).toBe(201);

    // 4th playdate creation in the same month must be rejected with 403 QUOTA_EXCEEDED
    const res4 = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        hostChildId,
        scheduledDate: new Date(Date.now() + 86400000 * 5).toISOString(),
        time: '08:00 - 10:00',
        activity: 'Dã ngoại cuối tuần',
        location: {
          name: 'Khu du lịch Văn Thánh',
          address: 'Bình Thạnh, TP. Hồ Chí Minh',
        },
      });

    expect(res4.status).toBe(403);
    expect(res4.body.success).toBe(false);
    expect(res4.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('11. PUT /api/v1/playdates/:id/respond: should allow invited guest to accept playdate invitation', async () => {
    const res = await request(app)
      .put(`/api/v1/playdates/${invitedPlaydateId}/respond`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const guestParticipant = res.body.data.participants.find(
      (p) => p.parentId === guestParentId
    );
    expect(guestParticipant).toBeDefined();
    expect(guestParticipant.status).toBe('accepted');

    // Accepting adds the guest to the playdate group chat
    const Conversation = (await import('../../src/modules/chat/conversation.model.js')).default;
    const conversation = await Conversation.findById(res.body.data.chatConversationId);
    expect(conversation.participants.map((p) => p.toString())).toContain(guestParentId);
  });

  it('12. POST /api/v1/playdates/:id/reschedule: should create pending reschedule request requiring participant consensus', async () => {
    const newDate = new Date(Date.now() + 86400000 * 7).toISOString();
    const res = await request(app)
      .post(`/api/v1/playdates/${invitedPlaydateId}/reschedule`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        newDate,
        newStartTime: '15:30 - 17:30',
        newLocation: {
          name: 'Công viên Gia Định Mới',
          address: 'Gò Vấp, TP. Hồ Chí Minh',
        },
        reason: 'Cuối tuần này bé bận học vẽ, dời sang tuần sau nhé',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rescheduleRequest.status).toBe('pending');
    expect(res.body.data.rescheduleRequest.responses.length).toBe(1);
    expect(res.body.data.rescheduleRequest.responses[0].parentId._id.toString()).toBe(guestParentId);
  });

  it('13. PUT /api/v1/playdates/:id/reschedule/vote: should update playdate schedule when all accepted participants agree', async () => {
    const res = await request(app)
      .put(`/api/v1/playdates/${invitedPlaydateId}/reschedule/vote`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rescheduleRequest.status).toBe('accepted');
    expect(res.body.data.playdate.time).toBe('15:30 - 17:30');
    expect(res.body.data.playdate.location.name).toBe('Công viên Gia Định Mới');
  });

  it('14. GET /api/v1/places/nearby: should return nearby child-friendly places from adapter cache', async () => {
    const res = await request(app)
      .get('/api/v1/places/nearby?type=park')
      .set('Authorization', `Bearer ${hostToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].placeType).toBe('park');
  });

  it('15. Search isolation: stranger search must not return other parents playdates', async () => {
    const strangerRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Stranger Parent',
      email: `stranger-${Date.now()}@test.com`,
      password: 'Password123!',
    });
    const strangerToken = strangerRes.body.data.tokens.accessToken;

    const res = await request(app)
      .get('/api/v1/playdates?search=Lego')
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.playdates).toEqual([]);
    expect(res.body.data.counts.all).toBe(0);
  });

  it('16. GET /api/v1/playdates/:id/reschedule: should return 403 when user is not host or participant', async () => {
    const strangerRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Another Stranger',
      email: `stranger2-${Date.now()}@test.com`,
      password: 'Password123!',
    });
    const strangerToken = strangerRes.body.data.tokens.accessToken;

    const res = await request(app)
      .get(`/api/v1/playdates/${invitedPlaydateId}/reschedule`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('17. PUT /api/v1/playdates/:id/respond: should reject second response with 400 ALREADY_RESPONDED', async () => {
    const res = await request(app)
      .put(`/api/v1/playdates/${invitedPlaydateId}/respond`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ status: 'declined' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ALREADY_RESPONDED');
  });

  it('18. POST /api/v1/playdates: should ignore mass assignment fields like completedAt and cancellation', async () => {
    let child = await Child.findOne({ parentId: guestParentId });
    if (!child) {
      const childRes = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({
          displayName: 'Bé Test',
          dateOfBirth: '2021-01-01',
          gender: 'boy',
          interests: ['music'],
        });
      child = { _id: childRes.body.data.id };
    }

    const res = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        hostChildId: child._id.toString(),
        scheduledDate: new Date(Date.now() + 86400000 * 2).toISOString(),
        time: '10:00 - 12:00',
        activity: 'Chơi cát bãi biển',
        location: {
          name: 'Bãi cát Thảo Điền',
          address: 'Quận 2, TP. Hồ Chí Minh',
        },
        completedAt: new Date(),
        cancellation: {
          cancelledBy: guestParentId,
          reason: 'Hacked',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('upcoming');
    expect(res.body.data.completedAt).toBeNull();
    expect(res.body.data.cancellation.cancelledBy).toBeNull();
    expect(res.body.data.cancellation.reason).not.toBe('Hacked');
  });

  it('19. POST /api/v1/playdates: should reject host adding self as participant (400 CANNOT_INVITE_SELF)', async () => {
    const res = await request(app)
      .post('/api/v1/playdates')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        hostChildId,
        scheduledDate: new Date(Date.now() + 86400000 * 3).toISOString(),
        time: '14:00 - 16:00',
        activity: 'Chơi bóng rổ',
        location: {
          name: 'Sân bóng thiếu nhi',
          address: 'Quận 7, TP. Hồ Chí Minh',
        },
        participants: [
          { parentId: hostParentId, childId: hostChildId },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CANNOT_INVITE_SELF');
  });

  it('20. POST /api/v1/playdates/:id/reschedule: should reject non-host requesting reschedule (403 FORBIDDEN_RESCHEDULE)', async () => {
    const res = await request(app)
      .post(`/api/v1/playdates/${invitedPlaydateId}/reschedule`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        newDate: new Date(Date.now() + 86400000 * 10).toISOString(),
        newStartTime: '09:00 - 11:00',
        reason: 'Guest wants to change time',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN_RESCHEDULE');
  });

  it('21. PUT /api/v1/playdates/:id/respond: should reject participation when Free quota exceeded (403 QUOTA_EXCEEDED)', async () => {
    let guestChild = await Child.findOne({ parentId: guestParentId });
    if (!guestChild) {
      guestChild = await Child.create({
        parentId: guestParentId,
        displayName: 'Bé Guest',
        dateOfBirth: new Date('2021-01-01'),
        gender: 'boy',
      });
    }

    // Create a new playdate where guest is invited
    const newPlaydate = await Playdate.create({
      hostParentId,
      hostChildId,
      scheduledDate: new Date(Date.now() + 86400000 * 4),
      time: '15:00 - 17:00',
      activity: 'Đá cầu',
      location: { name: 'Công viên', address: 'Quận 1' },
      participants: [
        { parentId: guestParentId, childId: guestChild._id, status: 'pending' },
      ],
      status: 'upcoming',
    });

    // Artificially max out guest's participation quota
    const yearMonth = new Date().toISOString().slice(0, 7);
    await UsageQuota.findOneAndUpdate(
      { parentId: guestParentId, periodType: 'monthly', periodValue: yearMonth },
      { $set: { 'counters.playdatesParticipated': 3 } },
      { upsert: true }
    );

    const res = await request(app)
      .put(`/api/v1/playdates/${newPlaydate._id}/respond`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ status: 'accepted' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });
});
