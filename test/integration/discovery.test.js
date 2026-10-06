import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import discoveryService from '../../src/modules/discovery/discovery.service.js';
import UsageQuota from '../../src/modules/subscription/usage-quota.model.js';
import subscriptionService from '../../src/modules/subscription/subscription.service.js';
import { QUOTA_PERIOD_TYPES } from '../../src/modules/subscription/subscription.constants.js';

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
        expect(profile).not.toHaveProperty('avatarUrl');
        expect(Number.isInteger(profile.distanceKm)).toBe(true);
        expect(Object.keys(profile.parent.preferences).sort()).toEqual([
          'preferredLocations',
          'preferredPlaydateDays',
          'preferredTimeSlots',
        ]);
      }
    });

    it('should reject lat without lng', async () => {
      const res = await request(app)
        .get('/api/v1/discovery?lat=10.8')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject ageMin greater than ageMax', async () => {
      const res = await request(app)
        .get('/api/v1/discovery?ageMin=8&ageMax=3')
        .set('Authorization', `Bearer ${parentAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
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

    it('should send a pending connection request when liking', async () => {
      const connection = await Connection.findOne({
        requesterId: parentAId,
        recipientId: parentBId,
      }).lean();

      expect(connection).not.toBeNull();
      expect(connection.status).toBe('pending');
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
      expect(res.body.data.connection).toBeNull();

      const connection = await Connection.findOne({ requesterId: parentAId, recipientId: parentCId });
      expect(connection).toBeNull();
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

    it('should not consume quota when a swipe is rejected', async () => {
      const fakeChildId = new mongoose.Types.ObjectId().toString();
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/api/v1/discovery/swipe')
          .set('Authorization', `Bearer ${quotaTestToken}`)
          .send({ targetChildId: fakeChildId, isLike: true });
        expect(res.status).toBe(404);
      }

      const res = await request(app)
        .get('/api/v1/discovery')
        .set('Authorization', `Bearer ${quotaTestToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.meta.remainingViews).toBe(5);
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

      // Pass on all 5 children (exhaust daily quota without touching connection quota)
      for (const targetId of targetChildIds) {
        await request(app)
          .post('/api/v1/discovery/swipe')
          .set('Authorization', `Bearer ${quotaTestToken}`)
          .send({ targetChildId: targetId, isLike: false });
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
      expect(res.body.error.details[0].message).toBe('discovery');
    });
  });

  // ============================================
  // Like = Connection Request
  // ============================================

  describe('Like sends a connection request', () => {
    const registerParentWithChild = async (label, connectionPrivacy) => {
      const reg = await request(app).post('/api/v1/auth/register').send({
        fullName: `${label} Parent`,
        email: `${label}-${Date.now()}-${Math.random()}@example.com`,
        password: testPassword,
      });
      const token = reg.body.data.tokens.accessToken;
      const profile = await request(app).get('/api/v1/parent/me').set('Authorization', `Bearer ${token}`);
      const parentId = profile.body.data.id || profile.body.data._id;
      if (connectionPrivacy) {
        await Parent.findByIdAndUpdate(parentId, { $set: { 'privacySettings.connectionPrivacy': connectionPrivacy } });
      }
      const child = await request(app)
        .post('/api/v1/children')
        .set('Authorization', `Bearer ${token}`)
        .send({ displayName: `${label} Child`, dateOfBirth: '2020-01-01', gender: 'girl' });
      return { token, parentId, childId: child.body.data.id || child.body.data._id };
    };

    const getRemainingViews = async (token) => {
      const res = await request(app).get('/api/v1/discovery?lat=10.8&lng=106.7').set('Authorization', `Bearer ${token}`);
      return res.body.data.meta.remainingViews;
    };

    it('should reject liking a parent who accepts no connections without consuming quota', async () => {
      const liker = await registerParentWithChild('liker-privacy');
      const target = await registerParentWithChild('nobody', 'nobody');

      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${liker.token}`)
        .send({ targetChildId: target.childId, isLike: true });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CONNECTION_NOT_ALLOWED');
      expect(await getRemainingViews(liker.token)).toBe(5);
    });

    it('should block a like when the monthly connection quota is used up, without consuming discovery quota', async () => {
      const liker = await registerParentWithChild('liker-quota');
      const extraTarget = await registerParentWithChild('target-extra');

      // Use up the 5 monthly connection requests directly in the quota counters
      await UsageQuota.updateOne(
        {
          parentId: liker.parentId,
          periodType: QUOTA_PERIOD_TYPES.MONTHLY,
          periodValue: subscriptionService.getPeriodValue(QUOTA_PERIOD_TYPES.MONTHLY),
        },
        { $set: { 'counters.connectionRequests': 5 } },
        { upsert: true }
      );

      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${liker.token}`)
        .send({ targetChildId: extraTarget.childId, isLike: true });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
      expect(res.body.error.details[0].message).toBe('connectionRequest');
      expect(await getRemainingViews(liker.token)).toBe(5);
    });

    it('should auto-connect when the recipient of a pending request likes back', async () => {
      const a = await registerParentWithChild('mutual-a');
      const b = await registerParentWithChild('mutual-b');

      await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ targetChildId: b.childId, isLike: true });

      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ targetChildId: a.childId, isLike: true });

      expect(res.status).toBe(201);
      expect(res.body.data.connection.isNew).toBe(false);
      expect(res.body.data.connection.isMatched).toBe(true);
      expect(res.body.data.connection.status).toBe('accepted');

      const connections = await Connection.find({ parents: { $all: [a.parentId, b.parentId] } }).lean();
      expect(connections).toHaveLength(1);
      expect(connections[0].status).toBe('accepted');
      expect(connections[0].connectedAt).not.toBeNull();
    });

    it('should keep the request pending when the requester likes again', async () => {
      const a = await registerParentWithChild('repeat-a');
      const b = await registerParentWithChild('repeat-b');

      // A likes B's child, then likes another child of B
      await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ targetChildId: b.childId, isLike: true });

      const secondChild = await Child.create({
        parentId: b.parentId,
        displayName: 'Second Child',
        dateOfBirth: new Date('2019-01-01'),
        gender: 'boy',
      });

      const res = await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ targetChildId: secondChild._id.toString(), isLike: true });

      expect(res.status).toBe(201);
      expect(res.body.data.connection.isMatched).toBe(false);
      expect(res.body.data.connection.status).toBe('pending');
    });
  });
});

// ============================================
// Radius accuracy (known distances)
// ============================================

describe('Discovery radius accuracy', () => {
  const password = 'Password123!';
  // 1 degree of latitude ≈ 111.3 km on MongoDB's sphere, so +0.09° ≈ 10 km and +0.27° ≈ 30 km
  const SEARCHER = [105.0, 20.0];
  const NEAR = [105.0, 20.09];
  const FAR = [105.0, 20.27];

  let searcherToken = '';
  let nearChildId = '';
  let farChildId = '';

  const createParentAt = async (label, coordinates) => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      fullName: `Radius ${label}`,
      email: `radius-${label}-${Date.now()}-${Math.random()}@example.com`,
      password,
    });
    const token = reg.body.data.tokens.accessToken;
    const me = await request(app).get('/api/v1/parent/me').set('Authorization', `Bearer ${token}`);
    const parentId = me.body.data.id || me.body.data._id;
    await Parent.findByIdAndUpdate(parentId, {
      $set: { 'location.coordinates': { type: 'Point', coordinates } },
    });
    const child = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: `Radius ${label} Child`, dateOfBirth: '2020-01-01', gender: 'boy' });
    return { token, childId: child.body.data.id || child.body.data._id };
  };

  const discover = (maxDistanceKm) =>
    request(app)
      .get(`/api/v1/discovery?maxDistanceKm=${maxDistanceKm}`)
      .set('Authorization', `Bearer ${searcherToken}`);

  const findChild = (res, childId) => res.body.data.profiles.find((p) => p.childId.toString() === childId);

  beforeAll(async () => {
    searcherToken = (await createParentAt('searcher', SEARCHER)).token;
    nearChildId = (await createParentAt('near', NEAR)).childId;
    farChildId = (await createParentAt('far', FAR)).childId;
  });

  it('excludes a parent just outside the radius (10 km away, radius 9 km)', async () => {
    const res = await discover(9);
    expect(res.status).toBe(200);
    expect(findChild(res, nearChildId)).toBeUndefined();
    expect(findChild(res, farChildId)).toBeUndefined();
  });

  it('includes a parent just inside the radius and reports ~10 km', async () => {
    const res = await discover(11);
    expect(findChild(res, nearChildId)?.distanceKm).toBe(10);
    expect(findChild(res, farChildId)).toBeUndefined();
  });

  it('scores distance against the searched radius, not only the saved preference', async () => {
    // Searcher preference is the default 15 km; the far child is ~30 km away
    const narrow = findChild(await discover(31), farChildId);
    const wide = findChild(await discover(50), farChildId);
    expect(wide.matchScore).toBeGreaterThan(narrow.matchScore);

    expect(discoveryService._calcDistanceScore(30, 50)).toBe(8);
    expect(discoveryService._calcDistanceScore(30, 31)).toBe(1);
    expect(discoveryService._calcDistanceScore(30, undefined)).toBe(0);
  });

  it('reports ~30 km for the far parent when the radius covers it', async () => {
    const res = await discover(31);
    expect(findChild(res, nearChildId)?.distanceKm).toBe(10);
    expect(findChild(res, farChildId)?.distanceKm).toBe(30);
  });
});

// ============================================
// Candidate pool & selected child
// ============================================

describe('Discovery candidate pool and selected child', () => {
  const password = 'Password123!';
  const BASE = [104.0, 19.0];

  const createParentAt = async (label, coordinates, children = []) => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      fullName: `Pool ${label}`,
      email: `pool-${label}-${Date.now()}-${Math.random()}@example.com`,
      password,
    });
    const token = reg.body.data.tokens.accessToken;
    const me = await request(app).get('/api/v1/parent/me').set('Authorization', `Bearer ${token}`);
    const parentId = me.body.data.id || me.body.data._id;
    await Parent.findByIdAndUpdate(parentId, {
      $set: { 'location.coordinates': { type: 'Point', coordinates } },
    });
    const childIds = [];
    for (const child of children) {
      const created = await Child.create({ parentId, dateOfBirth: new Date('2020-01-01'), gender: 'girl', ...child });
      childIds.push(created._id.toString());
    }
    return { token, parentId, childIds };
  };

  const findChild = (res, childId) => res.body.data.profiles.find((p) => p.childId.toString() === childId);

  it('still shows farther parents once the nearest candidates are all swiped', async () => {
    const searcher = await createParentAt('searcher', BASE);
    const near = await createParentAt('near', [104.0, 19.01], [{ displayName: 'Near Kid' }]);
    const far = await createParentAt('far', [104.0, 19.05], [{ displayName: 'Far Kid' }]);

    const originalPoolSize = discoveryService.candidatePoolSize;
    discoveryService.candidatePoolSize = 1;
    try {
      const first = await request(app).get('/api/v1/discovery').set('Authorization', `Bearer ${searcher.token}`);
      expect(findChild(first, near.childIds[0])).toBeDefined();
      expect(findChild(first, far.childIds[0])).toBeUndefined();

      await request(app)
        .post('/api/v1/discovery/swipe')
        .set('Authorization', `Bearer ${searcher.token}`)
        .send({ targetChildId: near.childIds[0], isLike: false });

      const second = await request(app).get('/api/v1/discovery').set('Authorization', `Bearer ${searcher.token}`);
      expect(findChild(second, far.childIds[0])).toBeDefined();
    } finally {
      discoveryService.candidatePoolSize = originalPoolSize;
    }
  });

  it('matches interests against the selected child only', async () => {
    const searcher = await createParentAt('multi', [103.0, 18.0], [
      { displayName: 'Lego Kid', interests: ['Lego'] },
      { displayName: 'Music Kid', interests: ['Âm nhạc'] },
    ]);
    const target = await createParentAt('target', [103.0, 18.01], [{ displayName: 'Lego Friend', interests: ['Lego'] }]);
    const [legoKidId, musicKidId] = searcher.childIds;

    const discoverFor = (childId) =>
      request(app).get(`/api/v1/discovery?childId=${childId}`).set('Authorization', `Bearer ${searcher.token}`);

    const forLegoKid = await discoverFor(legoKidId);
    expect(findChild(forLegoKid, target.childIds[0]).matchedInterestsCount).toBe(1);

    const forMusicKid = await discoverFor(musicKidId);
    expect(findChild(forMusicKid, target.childIds[0]).matchedInterestsCount).toBe(0);
  });

  it('rejects a childId that does not belong to the parent', async () => {
    const searcher = await createParentAt('owner-check', [102.0, 17.0], [{ displayName: 'Own Kid' }]);
    const other = await createParentAt('other', [102.0, 17.01], [{ displayName: 'Other Kid' }]);

    const res = await request(app)
      .get(`/api/v1/discovery?childId=${other.childIds[0]}`)
      .set('Authorization', `Bearer ${searcher.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
  });
});
