import { describe, it, expect, beforeAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import PlacesCache from '../../src/modules/places/places-cache.model.js';
import overpassAdapter from '../../src/integrations/maps/overpass.adapter.js';
import geocodingAdapter from '../../src/integrations/maps/geocoding.adapter.js';
import placesService, { gridCellsOf } from '../../src/modules/places/places.service.js';
import PlacesSyncTile from '../../src/modules/places/places-sync-tile.model.js';

const CENTER = [108.2208, 16.0678]; // Hải Châu, Đà Nẵng

const registerParent = async (label, coordinates) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Places ${label}`,
    email: `places-${label}-${Date.now()}-${Math.random()}@test.com`,
    password: 'Password123!',
  });
  if (coordinates) {
    await Parent.updateOne(
      { _id: res.body.data.parent.id },
      { $set: { location: { area: 'Phường Hải Châu', city: 'Đà Nẵng', coordinates: { type: 'Point', coordinates } } } },
    );
  }
  return res.body.data.tokens.accessToken;
};

// Small offset east of a point, in degrees (~111 m per 0.001)
const near = ([lng, lat], offset) => [lng + offset, lat];

const cachedPlace = (osmId, coordinates, overrides = {}) => ({
  osmId,
  name: `Địa điểm ${osmId}`,
  address: 'Phường Hải Châu, Đà Nẵng',
  placeType: 'park',
  coordinates: { type: 'Point', coordinates },
  lastFetchedAt: new Date(),
  ...overrides,
});

const get = (token, path) => request(app).get(path).set('Authorization', `Bearer ${token}`);

describe('Places module (OpenStreetMap cache)', () => {
  let token = '';

  beforeAll(async () => {
    await PlacesCache.createIndexes();
    token = await registerParent('main', CENTER);
    await PlacesCache.insertMany([
      cachedPlace('osm-way-1001', near(CENTER, 0.002), { name: 'Công viên APEC' }),
      cachedPlace('osm-way-1002', near(CENTER, 0.004), { name: 'Công viên 29/3' }),
      cachedPlace('osm-node-1003', near(CENTER, 0.006), { name: 'Sân chơi Bạch Đằng', placeType: 'playground' }),
      cachedPlace('osm-node-1004', near(CENTER, 0.008), { name: 'Thư viện Đà Nẵng', placeType: 'library' }),
      cachedPlace('osm-way-1005', near(CENTER, 0.01), { name: 'Bảo tàng Chăm', placeType: 'workshop' }),
      cachedPlace('osm-way-1006', near(CENTER, 0.012), { name: 'Kids Cafe Hải Châu', placeType: 'kids_cafe', address: '' }),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Authentication & validation', () => {
    it('rejects a request without a token', async () => {
      const res = await request(app).get('/api/v1/places/nearby');
      expect(res.status).toBe(401);
    });

    it.each([
      ['lat out of range', '/api/v1/places/nearby?lat=95&lng=106.7'],
      ['lng out of range', '/api/v1/places/nearby?lat=10.7&lng=185'],
      ['lat without lng', '/api/v1/places/nearby?lat=10.7'],
      ['radius too large', '/api/v1/places/nearby?radius=60000'],
      ['unknown type', '/api/v1/places/nearby?type=nightclub_party'],
      ['keyword too long', `/api/v1/places/nearby?keyword=${'a'.repeat(101)}`],
      ['invalid place id', '/api/v1/places/not-an-id'],
    ])('rejects %s', async (_label, path) => {
      const res = await get(token, path);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Nearby & Search', () => {
    it('asks the parent to set a location when there is none', async () => {
      const noLocation = await registerParent('no-location');
      const res = await get(noLocation, '/api/v1/places/nearby');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARENT_LOCATION_REQUIRED');
    });

    it('uses the parent location, nearest first, with the distance and without rating', async () => {
      const spy = jest.spyOn(overpassAdapter, 'searchArea');
      const res = await get(token, '/api/v1/places/nearby');

      expect(res.status).toBe(200);
      expect(res.body.data[0].name).toBe('Công viên APEC');
      expect(res.body.data[0].distanceMeters).toBeGreaterThan(0);
      expect(res.body.data[0].distanceMeters).toBeLessThan(res.body.data[1].distanceMeters);
      expect(res.body.data[0]).toMatchObject({ placeId: 'osm-way-1001', osmUrl: 'https://www.openstreetmap.org/way/1001' });
      expect(res.body.data[0]).not.toHaveProperty('rating');
      // Searching reads the cache only, never the slow public Overpass API
      expect(spy).not.toHaveBeenCalled();
    });

    it('filters by type and by name, escaping regex characters', async () => {
      const parks = await get(token, '/api/v1/places/nearby?type=park');
      expect(parks.body.data.length).toBeGreaterThan(0);
      parks.body.data.forEach((p) => expect(p.placeType).toBe('park'));

      const byName = await get(token, `/api/v1/places/nearby?search=${encodeURIComponent('thư viện')}`);
      expect(byName.body.data.map((p) => p.name)).toContain('Thư viện Đà Nẵng');

      const dangerous = await get(token, `/api/v1/places/nearby?search=${encodeURIComponent('.*+?^${}()|[\\]')}`);
      expect(dangerous.status).toBe(200);
    });

  });

  describe('Place details', () => {
    it('resolves a missing address once and keeps it in the cache', async () => {
      const place = await PlacesCache.findOne({ osmId: 'osm-way-1006' });
      const reverse = jest.spyOn(geocodingAdapter, 'reverseGeocode').mockResolvedValue('12 Lê Duẩn, Phường Hải Châu, Đà Nẵng');

      const res = await get(token, `/api/v1/places/${place._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Kids Cafe Hải Châu', address: '12 Lê Duẩn, Phường Hải Châu, Đà Nẵng' });
      expect(res.body.data.distanceMeters).toBeGreaterThan(0);
      expect(reverse).toHaveBeenCalledTimes(1);

      await get(token, `/api/v1/places/${place._id}`);
      expect(reverse).toHaveBeenCalledTimes(1);
    });

    it('returns 404 for an unknown place', async () => {
      const res = await get(token, '/api/v1/places/64b7f0c2a1b2c3d4e5f60789');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PLACE_NOT_FOUND');
    });
  });

  describe('Places sync (scripts/sync-places.js)', () => {
    it('splits the area into cells, stores every place and keeps going when a cell fails', async () => {
      const bbox = [16.0, 108.1, 16.1, 108.3]; // 1 x 2 cells of 0.1°
      const spy = jest
        .spyOn(overpassAdapter, 'searchArea')
        .mockResolvedValueOnce([
          cachedPlace('osm-way-4001', [108.15, 16.05], { name: 'Công viên Hòa Minh', address: '' }),
          // Already cached with a resolved address: the sync must not wipe it
          cachedPlace('osm-way-1006', near(CENTER, 0.012), { name: 'Kids Cafe Hải Châu', address: '' }),
        ])
        .mockRejectedValueOnce(new Error('Request failed with status code 504'));

      const result = await placesService.syncArea(bbox, { delayMs: 0 });

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0][0]).toEqual([16.0, 108.1, 16.1, 108.2]);
      expect(result).toMatchObject({ cells: 2, places: 2 });
      expect(result.failedCells).toHaveLength(1);
      expect(await PlacesCache.countDocuments({ osmId: 'osm-way-4001' })).toBe(1);
      const kept = await PlacesCache.findOne({ osmId: 'osm-way-1006' }).lean();
      expect(kept.address).toBe('12 Lê Duẩn, Phường Hải Châu, Đà Nẵng');

      // Every cell is recorded so the auto sync does not fetch it again
      const tiles = await PlacesSyncTile.find({ key: { $in: ['0.1:160:1081', '0.1:160:1082'] } }).sort({ key: 1 }).lean();
      expect(tiles.map((t) => t.status)).toEqual(['done', 'failed']);
      expect(tiles[0]).toMatchObject({ placesCount: 2, bbox: [16.0, 108.1, 16.1, 108.2] });
    });

    it('aligns any area on the fixed grid, so a city sync and the auto sync share cells', () => {
      const cells = gridCellsOf([15.85, 108.05, 16.2, 108.36], 0.1);
      expect(cells[0]).toEqual({ key: '0.1:158:1080', bbox: [15.8, 108.0, 15.9, 108.1], cellSizeDeg: 0.1 });
      expect(cells.at(-1).bbox).toEqual([16.1, 108.3, 16.2, 108.4]);
      expect(cells).toHaveLength(4 * 4);
    });
  });

  describe('Auto sync around a search', () => {
    const HUE = [107.59, 16.46];

    it('is off while Overpass is disabled (tests never call the public API)', async () => {
      const spy = jest.spyOn(overpassAdapter, 'searchArea');
      expect(await placesService.syncAround(HUE, { delayMs: 0 })).toEqual({ queued: 0 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('syncs the cells around the center once, then skips them while they are fresh', async () => {
      jest.spyOn(overpassAdapter, 'isEnabled', 'get').mockReturnValue(true);
      const spy = jest
        .spyOn(overpassAdapter, 'searchArea')
        .mockResolvedValueOnce([cachedPlace('osm-way-5001', HUE, { name: 'Công viên Thương Bạc' })])
        .mockResolvedValue([]);

      // 5 km around Huế spans 2 x 2 cells of 0.1°
      expect(await placesService.syncAround(HUE, { delayMs: 0 })).toEqual({ queued: 4 });
      expect(spy).toHaveBeenCalledTimes(4);
      expect(await PlacesCache.countDocuments({ osmId: 'osm-way-5001' })).toBe(1);
      expect(await PlacesSyncTile.countDocuments({ key: /^0\.1:16[45]:107[56]$/, status: 'done' })).toBe(4);

      // Concurrent searches of the same area do not queue the cells again
      const again = await Promise.all([
        placesService.syncAround(HUE, { delayMs: 0 }),
        placesService.syncAround(near(HUE, 0.01), { delayMs: 0 }),
      ]);
      expect(again).toEqual([{ queued: 0 }, { queued: 0 }]);
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it('tells the app that the area is being synced, without waiting for Overpass', async () => {
      jest.spyOn(overpassAdapter, 'isEnabled', 'get').mockReturnValue(true);
      let finishOverpass;
      const spy = jest
        .spyOn(overpassAdapter, 'searchArea')
        .mockReturnValue(new Promise((resolve) => { finishOverpass = resolve; }));
      // Middle of one grid cell: 5 km around it stays inside the cell
      const path = '/api/v1/places/nearby?lat=10.05&lng=105.75';

      const first = await get(token, path);
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual([]);
      expect(first.body.meta).toEqual({ areaSyncing: true });

      // A second search while the cell is still syncing: no new sync, still flagged
      const second = await get(token, path);
      expect(second.body.meta).toEqual({ areaSyncing: true });

      await new Promise((resolve) => setImmediate(resolve));
      finishOverpass([cachedPlace('osm-way-6001', [105.751, 10.051], { name: 'Công viên Lưu Hữu Phước' })]);
      await placesService._autoSyncQueue;
      expect(spy).toHaveBeenCalledTimes(1);

      const after = await get(token, path);
      expect(after.body.meta).toEqual({ areaSyncing: false });
      expect(after.body.data.map((p) => p.name)).toEqual(['Công viên Lưu Hữu Phước']);
    });

    it('retries a failed cell only after the retry delay', async () => {
      jest.spyOn(overpassAdapter, 'isEnabled', 'get').mockReturnValue(true);
      const spy = jest.spyOn(overpassAdapter, 'searchArea').mockRejectedValue(new Error('status code 504'));
      const HANOI = [105.8, 21.03]; // 2 x 2 cells as well

      expect(await placesService.syncAround(HANOI, { delayMs: 0 })).toEqual({ queued: 4 });
      expect(await placesService.syncAround(HANOI, { delayMs: 0 })).toEqual({ queued: 0 });
      expect(spy).toHaveBeenCalledTimes(4);
    });
  });

});
