import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';

describe('Playdate Management Integration Flow', () => {
  let hostToken = '';
  let guestToken = '';
  let hostParentId = '';
  let guestParentId = '';
  let hostChildId = '';
  let createdPlaydateId = '';

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

  it('5. PATCH /api/v1/playdates/:id/complete: should succeed when host completes it', async () => {
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
});
