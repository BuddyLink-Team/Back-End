import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';

describe('Subscription & Quota Integration Flow', () => {
  let parentToken = '';
  const testEmail = `sub-test-${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  beforeAll(async () => {
    // Register parent
    const res = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Subscription Test Parent',
      email: testEmail,
      password: testPassword,
    });
    parentToken = res.body.data.tokens.accessToken;

  });

  describe('GET /api/v1/subscriptions/plans', () => {
    it('should return available active subscription plans', async () => {
      const res = await request(app).get('/api/v1/subscriptions/plans');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const freePlan = res.body.data.find((p) => p.planCode === 'free');
      expect(freePlan).toBeDefined();
      expect(freePlan.price).toBe(0);
      expect(freePlan.features.childProfilesLimit).toBe(1);
    });
  });

  describe('GET /api/v1/subscriptions/my', () => {
    it('should retrieve current parent subscription and quota summary', async () => {
      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.quota).toBeDefined();
      expect(res.body.data.quota.planCode).toBe('free');
      expect(res.body.data.quota.limits.childProfiles).toBe(1);
      expect(res.body.data.quota.usage.childProfiles).toBe(0);
    });

    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/subscriptions/my');
      expect(res.status).toBe(401);
    });
  });

  describe('Child Profile Quota Enforcement', () => {
    it('should allow creating the 1st child on Free plan', async () => {
      const childData = {
        displayName: 'First Child',
        dateOfBirth: '2020-05-15',
        gender: 'boy',
        interests: ['Lego & Lắp ráp'],
      };

      const res = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${parentToken}`)
        .send(childData);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.displayName).toBe('First Child');
    });

    it('should block creating the 2nd child with 403 CHILD_QUOTA_EXCEEDED on Free plan', async () => {
      const childData = {
        displayName: 'Second Child',
        dateOfBirth: '2022-08-20',
        gender: 'girl',
        interests: ['Vẽ & Hội họa'],
      };

      const res = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${parentToken}`)
        .send(childData);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CHILD_QUOTA_EXCEEDED');
    });
  });
});
