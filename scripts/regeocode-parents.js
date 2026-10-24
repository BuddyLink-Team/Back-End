/**
 * Re-geocode every parent's saved location to the center of their ward (geocoding.adapter.js):
 * - wards since the 07/2025 merge get their boundary center;
 * - former ward names are mapped to the new ward that replaced them;
 * - locations saved while Nominatim could not be reached (city center fallback) get fixed.
 *
 * Each (ward, city) is geocoded once, one Nominatim request per second at most.
 *
 * Usage:
 *   node scripts/regeocode-parents.js           # dry run, prints the planned changes
 *   node scripts/regeocode-parents.js --apply   # writes the changes
 */
/* eslint-disable no-console -- CLI script output */
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Parent from '../src/modules/parent/parent.model.js';
import geocodingAdapter from '../src/integrations/maps/geocoding.adapter.js';
import { distanceKmBetween } from '../src/modules/discovery/matching.rules.js';

// Below this move the saved point is considered the same (rounding of the stored coordinates)
const SAME_POINT_KM = 0.05;
const NOMINATIM_INTERVAL_MS = 1100;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ apply?: boolean, intervalMs?: number, log?: (message: string) => void }} [options]
 * @returns {Promise<{ parents: number, places: number, updated: number, unchanged: number, skipped: number }>}
 */
export const regeocodeParents = async ({ apply = false, intervalMs = NOMINATIM_INTERVAL_MS, log = () => {} } = {}) => {
  const parents = await Parent.find({ $or: [{ 'location.area': { $nin: ['', null] } }, { 'location.city': { $nin: ['', null] } }] })
    .select('_id fullName location')
    .lean();
  const result = { parents: parents.length, places: 0, updated: 0, unchanged: 0, skipped: 0 };

  const pointsByPlace = new Map();
  for (const parent of parents) {
    const { area = '', city = '' } = parent.location || {};
    const key = `${area.trim().toLowerCase()}|${city.trim().toLowerCase()}`;
    if (!pointsByPlace.has(key)) {
      if (pointsByPlace.size > 0) await wait(intervalMs);
      pointsByPlace.set(key, await geocodingAdapter.getCoordinatesByAddress(area, city));
    }
    const nextPoint = pointsByPlace.get(key);
    const currentPoint = parent.location?.coordinates?.coordinates;

    if (!Array.isArray(nextPoint)) {
      result.skipped += 1;
      continue;
    }
    const movedKm = Array.isArray(currentPoint) ? distanceKmBetween(currentPoint, nextPoint) : Infinity;
    if (movedKm < SAME_POINT_KM) {
      result.unchanged += 1;
      continue;
    }

    log(
      `  ${parent.fullName} (${[area, city].filter(Boolean).join(', ')}): [${currentPoint}] -> [${nextPoint}]` +
        (Number.isFinite(movedKm) ? ` (${movedKm.toFixed(2)} km)` : '')
    );
    if (apply) {
      await Parent.updateOne({ _id: parent._id }, { $set: { 'location.coordinates': { type: 'Point', coordinates: nextPoint } } });
    }
    result.updated += 1;
  }

  result.places = pointsByPlace.size;
  log(`Parents with a location: ${result.parents} (${result.places} distinct ward/city)`);
  log(`${apply ? 'Updated' : 'To update'}: ${result.updated}, unchanged: ${result.unchanged}, skipped: ${result.skipped}`);
  return result;
};

async function main() {
  const apply = process.argv.includes('--apply');
  dotenv.config();
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not defined in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Target database: ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(apply ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no changes written)\n');
  await regeocodeParents({ apply, log: console.log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('Parent re-geocoding failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
