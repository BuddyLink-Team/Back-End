/**
 * Fill places_cache with kid-friendly places from OpenStreetMap (Overpass API).
 * The server also fills the cache by itself around parents who search places (PLACES_AUTO_SYNC),
 * this script loads a whole city up front and refreshes it from time to time.
 *
 * Usage:
 *   npm run places:sync -- --city "Huế"                 (bounding box looked up on OpenStreetMap)
 *   npm run places:sync -- --area da-nang
 *   npm run places:sync -- --bbox 15.95,108.15,16.10,108.30 [--cell 0.05]
 *   npm run places:sync -- --list
 * Areas larger than PLACES_SYNC_DEFAULTS.MAX_CELLS cells are refused unless --force is given.
 *
 * Writes to MONGODB_URI from .env (upserts only, nothing is deleted).
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import placesService, { gridCellsOf } from '../src/modules/places/places.service.js';
import geocodingAdapter from '../src/integrations/maps/geocoding.adapter.js';
import overpassAdapter from '../src/integrations/maps/overpass.adapter.js';
import { PLACES_SYNC_AREAS, PLACES_SYNC_DEFAULTS } from '../src/modules/places/places.constants.js';

const readArg = (name) => {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

/**
 * Resolve the bounding box from --area or --bbox
 * @returns {{ label: string, bbox: number[] }}
 */
export const resolveSyncArea = ({ area, bbox }) => {
  if (bbox) {
    const values = bbox.split(',').map(Number);
    const [south, west, north, east] = values;
    if (values.length !== 4 || values.some((v) => !Number.isFinite(v)) || south >= north || west >= east) {
      throw new Error('--bbox must be "south,west,north,east" with south < north and west < east');
    }
    return { label: `bbox ${bbox}`, bbox: values };
  }
  const preset = PLACES_SYNC_AREAS[area];
  if (!preset) {
    throw new Error(`Unknown area "${area}". Known areas: ${Object.keys(PLACES_SYNC_AREAS).join(', ')}`);
  }
  return preset;
};

/**
 * Resolve the bounding box of a place name (--city) on OpenStreetMap Nominatim
 * @param {string} city
 * @returns {Promise<{ label: string, bbox: number[] }>}
 */
export const resolveCityArea = async (city) => {
  const found = await geocodingAdapter.getBoundingBox(city);
  if (!found) throw new Error(`No place named "${city}" found in Vietnam on OpenStreetMap`);
  return found;
};

/**
 * Sync one area into the connected database (used by this CLI and scripts/dev-memory.js)
 * @param {{ label: string, bbox: number[] }} area
 * @param {Object} [options] - cellSizeDeg, ... (placesService.syncArea)
 */
export async function syncPlaces(area, options = {}) {
  if (!overpassAdapter.isEnabled) {
    console.log('OVERPASS_ENABLED=false: places sync skipped.');
    return null;
  }
  console.log(`Syncing places of ${area.label} [${area.bbox.join(', ')}] from OpenStreetMap...`);
  const result = await placesService.syncArea(area.bbox, {
    ...options,
    onProgress: ({ cell, cells, places, error }) =>
      console.log(`  cell ${cell}/${cells}: ${error ? `failed (${error})` : `${places} places`}`),
  });
  console.log(`Places sync done: ${result.places} places from ${result.cells - result.failedCells.length}/${result.cells} cells.`);
  if (result.failedCells.length > 0) {
    console.log('Some cells failed (public Overpass busy). Re-run later, or with a smaller --cell.');
  }
  return result;
}

async function main() {
  if (process.argv.includes('--list')) {
    Object.entries(PLACES_SYNC_AREAS).forEach(([key, { label, bbox }]) => console.log(`${key}: ${label} [${bbox}]`));
    return;
  }

  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore if not allowed
  }

  const city = readArg('city');
  const area = city
    ? await resolveCityArea(city)
    : resolveSyncArea({ area: readArg('area') || 'da-nang', bbox: readArg('bbox') });
  const cellSizeDeg = Number(readArg('cell')) || PLACES_SYNC_DEFAULTS.CELL_SIZE_DEG;

  // A province-wide box takes hours on the public Overpass API
  const cellCount = gridCellsOf(area.bbox, cellSizeDeg).length;
  if (cellCount > PLACES_SYNC_DEFAULTS.MAX_CELLS && !process.argv.includes('--force')) {
    console.error(
      `${area.label} [${area.bbox.join(', ')}] covers ${cellCount} cells (limit ${PLACES_SYNC_DEFAULTS.MAX_CELLS}).
` +
        'Use a more precise name (e.g. a city instead of a province), or add --force to sync it anyway.'
    );
    process.exitCode = 1;
    return;
  }

  dotenv.config();
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not defined in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Target database: ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  await placesService.ensureIndexes();

  const result = await syncPlaces(area, { cellSizeDeg });
  if (result?.failedCells.length === result?.cells) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('Places sync failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
