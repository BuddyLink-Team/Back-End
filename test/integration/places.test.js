import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import PlacesCache from '../../src/modules/discovery/places-cache.model.js';
import placesService from '../../src/modules/discovery/places.service.js';

describe('Places Discovery Module Integration Tests', () => {
  let parentToken = '';

  beforeAll(async () => {
    // Register a test parent to get access token
    const registerRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Test Parent Places',
      email: `places-tester-${Date.now()}@test.com`,
      password: 'Password123!',
    });

    parentToken = registerRes.body.data.tokens.accessToken;

    // Ensure 2dsphere index and seed places cache
    await PlacesCache.createIndexes();
    await placesService.initPlacesSeed();
  });

  describe('1. Authentication & Authorization', () => {
    it('should reject request with 401 when token is missing', async () => {
      const res = await request(app).get('/api/v1/places/nearby');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should allow authenticated parent to access nearby places', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('2. Input Validation (400 Bad Request)', () => {
    it('should reject lat out of [-90, 90] range', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?lat=95&lng=106.7')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject lng out of [-180, 180] range', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?lat=10.7&lng=185')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject if lat is provided without lng', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?lat=10.7')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject if lng is provided without lat', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?lng=106.7')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject radius exceeding 50,000 meters', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?radius=60000')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject radius below 100 meters', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?radius=50')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid placeType category', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?type=nightclub_party')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject keyword exceeding 100 characters', async () => {
      const longKeyword = 'a'.repeat(101);
      const res = await request(app)
        .get(`/api/v1/places/nearby?keyword=${longKeyword}`)
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Query Filtering & Safe Search', () => {
    it('should filter places by specific category type', async () => {
      const res = await request(app)
        .get('/api/v1/places/nearby?type=park')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((place) => {
        expect(place.placeType).toBe('park');
      });
    });

    it('should safely escape regex special characters without crashing (ReDoS protection)', async () => {
      const dangerousRegexInput = '.*+?^${}()|[\\]\\';
      const res = await request(app)
        .get(`/api/v1/places/nearby?search=${encodeURIComponent(dangerousRegexInput)}`)
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should find places matching keyword in name or address', async () => {
      const res = await request(app)
        .get(`/api/v1/places/nearby?keyword=${encodeURIComponent('Gia Định')}`)
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      const found = res.body.data.some((p) => p.name.includes('Gia Định'));
      expect(found).toBe(true);
    });

    it('should support geospatial search with valid lat and lng', async () => {
      // Coordinates near Crescent Mall & Kawaii Kids Cafe (District 7, HCMC)
      const res = await request(app)
        .get('/api/v1/places/nearby?lat=10.7291&lng=106.7188&radius=10000')
        .set('Authorization', `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('placeId');
      expect(res.body.data[0]).toHaveProperty('coordinates');
    });
  });
});
