import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import mongoose from 'mongoose';
import Parent from '../../src/modules/parent/parent.model.js';
import geocodingAdapter from '../../src/integrations/maps/geocoding.adapter.js';
import { regeocodeParents } from '../../scripts/regeocode-parents.js';

const { ObjectId } = mongoose.Types;

// The script reads every parent: run it on its own database, not the one shared by the other suites
describe('regeocode-parents script', () => {
  beforeAll(async () => {
    await mongoose.disconnect();
    await mongoose.connect('mongodb://127.0.0.1:27018/regeocode_parents');
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
  });

  it('moves every parent to their ward center, geocoding each ward once, and is idempotent', async () => {
    const parent = (fullName, area, coordinates) =>
      Parent.create({
        userId: new ObjectId(),
        fullName,
        location: { area, city: 'Thành phố Đà Nẵng', coordinates: { type: 'Point', coordinates } },
      });
    // Saved at the city center while Nominatim was unreachable
    const a = await parent('A', 'Phường Hội An Đông', [108.2022, 16.0544]);
    const b = await parent('B', 'Phường Hội An Đông', [108.2022, 16.0544]);
    // Already at the ward center
    const c = await parent('C', 'Phường Hải Châu', [108.2195, 16.059]);

    const centers = { 'Phường Hội An Đông': [108.364, 15.8786], 'Phường Hải Châu': [108.2195, 16.059] };
    const geocode = jest.spyOn(geocodingAdapter, 'getCoordinatesByAddress').mockImplementation(async (area) => centers[area]);

    const dryRun = await regeocodeParents({ intervalMs: 0 });
    expect(dryRun).toEqual({ parents: 3, places: 2, updated: 2, unchanged: 1, skipped: 0 });
    expect((await Parent.findById(a._id).lean()).location.coordinates.coordinates).toEqual([108.2022, 16.0544]);

    const applied = await regeocodeParents({ apply: true, intervalMs: 0 });
    expect(applied.updated).toBe(2);
    expect(geocode).toHaveBeenCalledTimes(4); // 2 distinct wards x 2 runs
    for (const p of [a, b]) {
      expect((await Parent.findById(p._id).lean()).location.coordinates.coordinates).toEqual([108.364, 15.8786]);
    }
    expect((await Parent.findById(c._id).lean()).location.coordinates.coordinates).toEqual([108.2195, 16.059]);

    expect((await regeocodeParents({ apply: true, intervalMs: 0 })).updated).toBe(0);
    geocode.mockRestore();
  });
});
