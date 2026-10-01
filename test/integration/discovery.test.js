import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';

describe('Discovery & Smart Matching Integration Flow', () => {
  // Parent A: the searcher
  let parentAToken = '';
  let parentAId = '';

  // Parent B: a nearby parent whose child should appear in discovery
  let parentBToken = '';
  let parentBId = '';
  let childBId = '';

  // Parent C: another nearby parent
  let parentCToken = '';
  let parentCId = '';
  let childCId = '';

  const parentAEmail = `discovery-a-${Date.now()}@example.com`;
  const parentBEmail = `discovery-b-${Date.now()}@example.com`;
  const parentCEmail = `discovery-c-${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  // Coordinates: Ho Chi Minh City area (close together)
  const coordsA = [106.7, 10.8]; // [lng, lat]
  const coordsB = [106.71, 10.81]; // ~1.5km from A
  const coordsC = [106.72, 10.82]; // ~3km from A

  beforeAll(async () => {
    // ---- Register Parent A ----
    const resA = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Parent A Discovery',
      email: parentAEmail,
      password: testPassword,
    });
    parentAToken = resA.body.data.tokens.accessToken;

    // Get Parent A's parentId and update location
    const profileA = await request(app)
      .get('/api/v1/parent/me')
      .set('Authorization', `Bearer ${parentAToken}`);
    parentAId = profileA.body.data.id || profileA.body.data._id;

    // Update Parent A's location and preferences directly in DB
    await Parent.findByIdAndUpdate(parentAId, {
      $set: {
        'location.address': '123 Test St, District 1',
        'location.area': 'District 1',
        'location.city': 'Ho Chi Minh City',
        'location.coordinates': {
          type: 'Point',
          coordinates: coordsA,
        },
        'preferences.maxDistanceKm': 15,
        'preferences.preferredAgeRange': { min: 3, max: 8 },
        'preferences.preferredPlaydateDays': ['weekend'],
        'preferences.preferredTimeSlots': ['morning'],
        'preferences.preferredLocations': ['park', 'outdoor'],
      },
    });

    // Create a child for Parent A (for interest matching)
    await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${parentAToken}`)
      .send({
        displayName: 'Child A',
        dateOfBirth: '2020-06-15',
        gender: 'boy',
        interests: ['Lego', 'Drawing', 'Dinosaurs'],
        favoriteActivities: ['Park', 'Swimming'],
      });

    // ---- Register Parent B ----
    const resB = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Parent B Discovery',
      email: parentBEmail,
      password: testPassword,
    });
    parentBToken = resB.body.data.tokens.accessToken;

    const profileB = await request(app)
      .get('/api/v1/parent/me')
      .set('Authorization', `Bearer ${parentBToken}`);
    parentBId = profileB.body.data.id || profileB.body.data._id;

    // Update Parent B's location
    await Parent.findByIdAndUpdate(parentBId, {
      $set: {
        'location.address': '456 Test St, Binh Thanh',
        'location.area': 'Binh Thanh',
        'location.city': 'Ho Chi Minh City',
        'location.coordinates': {
          type: 'Point',
          coordinates: coordsB,
        },
        'preferences.preferredPlaydateDays': ['weekend'],
        'preferences.preferredTimeSlots': ['morning'],
        'preferences.preferredLocations': ['park'],
      },
    });

    // Create child for Parent B
    const childBRes = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${parentBToken}`)
      .send({
        displayName: 'Child B',
        dateOfBirth: '2021-03-10',
        gender: 'girl',
        interests: ['Lego', 'Drawing', 'Music'],
        favoriteActivities: ['Park', 'Cycling'],
      });
    childBId = childBRes.body.data.id || childBRes.body.data._id;

    // ---- Register Parent C ----
    const resC = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Parent C Discovery',
      email: parentCEmail,
      password: testPassword,
    });
    parentCToken = resC.body.data.tokens.accessToken;

    const profileC = await request(app)
      .get('/api/v1/parent/me')
      .set('Authorization', `Bearer ${parentCToken}`);
    parentCId = profileC.body.data.id || profileC.body.data._id;

    await Parent.findByIdAndUpdate(parentCId, {
      $set: {
        'location.address': '789 Test St, Go Vap',
        'location.area': 'Go Vap',
        'location.city': 'Ho Chi Minh City',
        'location.coordinates': {
          type: 'Point',
          coordinates: coordsC,
        },
        'preferences.preferredPlaydateDays': ['weekday'],
        'preferences.preferredTimeSlots': ['afternoon'],
      },
    });

    const childCRes = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${parentCToken}`)
      .send({
        displayName: 'Child C',
        dateOfBirth: '2019-11-20',
        gender: 'boy',
        interests: ['Football', 'Running'],
        favoriteActivities: ['Sports', 'Outdoor'],
      });
    childCId = childCRes.body.data.id || childCRes.body.data._id;

    // Ensure 2dsphere index is ready
    await Parent.collection.createIndex({ 'location.coordinates': '2dsphere' });
  });

  // ============================================
  // GET /api/v1/discovery
  // ============================================

  describe('GET /api/v1/discovery', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/discovery');
      expect(res.status).toBe(401);
    });

    it('should return discovery profiles for authenticated parent', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.profiles).toBeDefined();
      expect(Array.isArray(res.body.data.profiles)).toBe(true);
      expect(res.body.data.meta).toBeDefined();
      expect(res.body.data.meta.isPremium).toBe(false);
    });

    it('should not include the requesting parent own children in results', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      const profiles = res.body.data.profiles;
      const selfChildren = profiles.filter(
        (p) => p.parentId.toString() === parentAId.toString()
      );
      expect(selfChildren.length).toBe(0);
    });

    it('should return profiles with matchScore between 0 and 100', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      const profiles = res.body.data.profiles;
      profiles.forEach((profile) => {
        expect(profile.matchScore).toBeGreaterThanOrEqual(0);
        expect(profile.matchScore).toBeLessThanOrEqual(100);
        expect(profile.distanceKm).toBeDefined();
        expect(typeof profile.distanceKm).toBe('number');
      });
    });

    it('should return profiles sorted by matchScore descending', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      const profiles = res.body.data.profiles;
      for (let i = 1; i < profiles.length; i++) {
        expect(profiles[i - 1].matchScore).toBeGreaterThanOrEqual(profiles[i].matchScore);
      }
    });

    it('should return profile shape matching FE contract', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      if (res.body.data.profiles.length > 0) {
        const profile = res.body.data.profiles[0];
        expect(profile).toHaveProperty('childId');
        expect(profile).toHaveProperty('parentId');
        expect(profile).toHaveProperty('displayName');
        expect(profile).toHaveProperty('age');
        expect(profile).toHaveProperty('gender');
        expect(profile).toHaveProperty('interests');
        expect(profile).toHaveProperty('favoriteActivities');
        expect(profile).toHaveProperty('personality');
        expect(profile).toHaveProperty('parent');
        expect(profile.parent).toHaveProperty('fullName');
        expect(profile.parent).toHaveProperty('isVerifiedParent');
        expect(profile).toHaveProperty('matchScore');
        expect(profile).toHaveProperty('distanceKm');
      }
    });

    it('should return meta with remainingViews for Free plan', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      const meta = res.body.data.meta;
      expect(meta).toHaveProperty('remainingViews');
      expect(meta).toHaveProperty('isPremium');
      expect(meta.isPremium).toBe(false);
      expect(typeof meta.remainingViews).toBe('number');
    });

    it('should filter by custom coordinates', async () => {
      const res = await request(app)
        .get('/api/v1/discovery?lat=10.8&lng=106.7&maxDistanceKm=5')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ============================================
  // POST /api/v1/discovery/swipe
  // ============================================

  describe('POST /api/v1/discovery/swipe', () => {
    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .send({ targetChildId: childBId, isLike: true });
      expect(res.status).toBe(401);
    });

    it('should record a LIKE swipe successfully', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${parentAToken}`)
        .send({ targetChildId: childBId, isLike: true });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.swipeId).toBeDefined();
      expect(res.body.data.isLike).toBe(true);
      expect(typeof res.body.data.remainingViews).toBe('number');
    });

    it('should reject duplicate swipe with 409', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${parentAToken}`)
        .send({ targetChildId: childBId, isLike: true });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DUPLICATE_SWIPE');
    });

    it('should record a PASS swipe successfully', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${parentAToken}`)
        .send({ targetChildId: childCId, isLike: false });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isLike).toBe(false);
    });

    it('should exclude swiped profiles from discovery results', async () => {
      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(200);
      const profiles = res.body.data.profiles;
      const swipedIds = [childBId, childCId];
      profiles.forEach((profile) => {
        expect(swipedIds).not.toContain(profile.childId.toString());
      });
    });

    it('should reject swipe with invalid targetChildId', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${parentAToken}`)
        .send({ targetChildId: 'invalid-id', isLike: true });

      expect(res.status).toBe(400);
    });

    it('should reject swipe without isLike field', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${parentAToken}`)
        .send({ targetChildId: childBId });

      expect(res.status).toBe(400);
    });

    it('should reject swipe on non-existent child', async () => {
      const fakeChildId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${parentAToken}`)
        .send({ targetChildId: fakeChildId, isLike: true });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
    });
  });

  // ============================================
  // Quota Enforcement (Free Plan: 5/day)
  // ============================================

  describe('Discovery Quota Enforcement', () => {
    let quotaTestToken = '';
    let quotaTestParentId = '';

    beforeAll(async () => {
      const email = `quota-test-${Date.now()}@example.com`;
      const res = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Quota Test Parent',
        email,
        password: testPassword,
      });
      quotaTestToken = res.body.data.tokens.accessToken;

      const profile = await request(app)
        .get('/api/v1/parent/me')
        .set('Authorization', `Bearer ${quotaTestToken}`);
      quotaTestParentId = profile.body.data.id || profile.body.data._id;

      await Parent.findByIdAndUpdate(quotaTestParentId, {
        $set: {
          'location.coordinates': {
            type: 'Point',
            coordinates: [106.7, 10.8],
          },
        },
      });
    });

    it('should block swipe when Free daily quota is exceeded', async () => {
      // Create 5 target children from different parents to exhaust quota
      const targetChildIds = [];
      for (let i = 0; i < 5; i++) {
        const email = `target-parent-${Date.now()}-${i}@example.com`;
        const regRes = await request(app).post('/api/v1/auth/register').send({
          fullName: `Target Parent ${i}`,
          email,
          password: testPassword,
        });
        const tToken = regRes.body.data.tokens.accessToken;

        const childRes = await request(app)
          .post('/api/v1/children')
          .set('Authorization', `Bearer ${tToken}`)
          .send({
            displayName: `Target Child ${i}`,
            dateOfBirth: '2021-01-01',
            gender: 'boy',
          });
        targetChildIds.push(childRes.body.data.id || childRes.body.data._id);
      }

      // Swipe on all 5 children (exhaust daily quota)
      for (const targetId of targetChildIds) {
        await request(app)
          .post('/api/v1/discovery/swipe')
          .set('Authorization', `Bearer ${quotaTestToken}`)
          .send({ targetChildId: targetId, isLike: true });
      }

      // Create 6th target child
      const extraEmail = `extra-parent-${Date.now()}@example.com`;
      const extraReg = await request(app).post('/api/v1/auth/register').send({
        fullName: 'Extra Parent',
        email: extraEmail,
        password: testPassword,
      });
      const extraToken = extraReg.body.data.tokens.accessToken;
      const extraChild = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${extraToken}`)
        .send({
          displayName: 'Extra Child',
          dateOfBirth: '2021-06-01',
          gender: 'girl',
        });
      const extraChildId = extraChild.body.data.id || extraChild.body.data._id;

      // 6th swipe should be blocked
      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${quotaTestToken}`)
        .send({ targetChildId: extraChildId, isLike: true });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    });
  });
});
