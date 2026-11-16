/**
 * Adds the kid-friendly places of scripts/data/places.seed.json (taken from the old database buddylink_db and
 * checked one by one on OpenStreetMap) to places_cache.
 *
 * - Every place is an OpenStreetMap element (osmId). Its coordinates are the ones of OpenStreetMap, never typed by
 *   hand: the node position, or the center of a way / relation as Overpass returns it ("out center", the same point
 *   the places sync stores). --verify reads them again and compares them with the file and with Nominatim.
 * - Places are upserted by osmId with source "manual" (a places sync never removes them). A place already in the
 *   database keeps its attractions, opening hours, phone and website; its name, address, type and point are updated.
 *
 * Usage:
 *   node scripts/migrate-places.js                         # dry run on the database of MONGODB_URI
 *   node scripts/migrate-places.js --apply                 # writes the places
 *   node scripts/migrate-places.js --db buddylink_final    # another database of the same cluster
 *   node scripts/migrate-places.js --verify                # checks the file against OpenStreetMap (no database)
 *   node scripts/migrate-places.js --verify --write-json   # ...and writes the OpenStreetMap coordinates into the file
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import axios from 'axios';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { publicDnsHttpsAgent } from '../src/integrations/maps/public-dns.agent.js';
import { PLACE_SOURCES, PLACE_TYPES } from '../src/modules/places/places.constants.js';

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'places.seed.json');
const OVERPASS_URLS = (process.env.OVERPASS_API_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/lookup';
const USER_AGENT = 'BuddyLinkApp/1.0 (places migration)';
// The file must match OpenStreetMap to the metre; a way / relation center further than this from the Nominatim
// centroid is reported for a look (big or oddly shaped areas)
const FILE_TOLERANCE_M = 1;
const CENTROID_REVIEW_M = 50;
// A place already in the database is moved when its point is further than this from the file
const MOVE_THRESHOLD_M = 1;

// Usual opening hours per place type (OSM opening_hours format), when OpenStreetMap has none
const DEFAULT_OPENING_HOURS = {
  [PLACE_TYPES.PARK]: '05:00-22:00',
  [PLACE_TYPES.PLAYGROUND]: '06:00-21:00',
  [PLACE_TYPES.KIDS_CAFE]: 'Mo-Su 08:00-21:30',
  [PLACE_TYPES.LIBRARY]: 'Tu-Su 07:30-17:00',
  [PLACE_TYPES.SPORTS_CENTER]: 'Mo-Su 06:00-21:00',
  [PLACE_TYPES.WORKSHOP]: 'Mo-Su 08:00-17:00',
};
// OSM tags kept on a place (same as the places sync)
const KEPT_TAGS = ['leisure', 'amenity', 'sport', 'tourism', 'indoor', 'shop', 'attraction'];

const argValue = (name) => {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.split('=')[1];
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Distance in metres between two [lng, lat] points */
export const distanceM = ([lng1, lat1], [lng2, lat2]) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
};

const parseOsmId = (osmId) => {
  const match = /^osm-(node|way|relation)-(\d+)$/.exec(osmId || '');
  if (!match) throw new Error(`Not an OpenStreetMap id: ${osmId}`);
  return { type: match[1], id: match[2] };
};

export const readPlacesFile = () => JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

const validatePlaces = (places) => {
  const types = new Set(Object.values(PLACE_TYPES));
  const seen = new Set();
  for (const place of places) {
    parseOsmId(place.osmId);
    if (seen.has(place.osmId)) throw new Error(`Duplicate place ${place.osmId}`);
    seen.add(place.osmId);
    if (!place.name?.trim() || !place.address?.trim()) throw new Error(`${place.osmId} needs a name and an address`);
    if (!types.has(place.placeType)) throw new Error(`${place.osmId} has an unknown placeType ${place.placeType}`);
  }
};

/**
 * Elements of OpenStreetMap by osmId, from Overpass: [lng, lat] (node position or way / relation center) and tags
 * @param {Array<string>} osmIds
 * @returns {Promise<Map<string, { coordinates: [number, number], tags: Object }>>}
 */
async function fetchOverpass(osmIds) {
  const ids = { node: [], way: [], relation: [] };
  osmIds.forEach((osmId) => {
    const { type, id } = parseOsmId(osmId);
    ids[type].push(id);
  });
  const parts = Object.entries(ids)
    .filter(([, list]) => list.length)
    .map(([type, list]) => `${type}(id:${list.join(',')});`)
    .join('');
  const query = `[out:json][timeout:60];(${parts});out center tags;`;

  let lastError;
  for (const url of OVERPASS_URLS) {
    try {
      const { data } = await axios.post(url, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        httpsAgent: publicDnsHttpsAgent,
        timeout: 90000,
      });
      return new Map(
        (data.elements || []).map((element) => {
          const lat = element.lat ?? element.center?.lat;
          const lng = element.lon ?? element.center?.lon;
          return [`osm-${element.type}-${element.id}`, { coordinates: [lng, lat], tags: element.tags || {} }];
        })
      );
    } catch (error) {
      lastError = error;
      console.log(`Overpass ${url} failed (${error.message}), trying the next one`);
    }
  }
  throw new Error(`Overpass unavailable: ${lastError?.message}`);
}

/**
 * Nominatim centroid of each element (a second source to compare with)
 * @param {Array<string>} osmIds
 * @returns {Promise<Map<string, [number, number]>>}
 */
async function fetchNominatim(osmIds) {
  const result = new Map();
  const letter = { node: 'N', way: 'W', relation: 'R' };
  for (let i = 0; i < osmIds.length; i += 40) {
    const chunk = osmIds.slice(i, i + 40).map((osmId) => {
      const { type, id } = parseOsmId(osmId);
      return `${letter[type]}${id}`;
    });
    const { data } = await axios.get(NOMINATIM_URL, {
      params: { format: 'jsonv2', osm_ids: chunk.join(',') },
      headers: { 'User-Agent': USER_AGENT },
      httpsAgent: publicDnsHttpsAgent,
      timeout: 30000,
    });
    data.forEach((row) => result.set(`osm-${row.osm_type}-${row.osm_id}`, [Number(row.lon), Number(row.lat)]));
    await sleep(1100);
  }
  return result;
}

/**
 * Compare the file with OpenStreetMap
 * @returns {Promise<{ problems: number, places: Array<Object> }>} places with the OpenStreetMap coordinates
 */
export async function verifyPlaces(places) {
  const osmIds = places.map((place) => place.osmId);
  const [overpass, nominatim] = [await fetchOverpass(osmIds), await fetchNominatim(osmIds)];
  let problems = 0;
  const verified = places.map((place) => {
    const osm = overpass.get(place.osmId);
    if (!osm || typeof osm.coordinates[0] !== 'number') {
      problems += 1;
      console.log(`MISSING  ${place.osmId}  ${place.name}: not on OpenStreetMap any more`);
      return place;
    }
    const centroid = nominatim.get(place.osmId);
    const fromFile = Array.isArray(place.coordinates) ? distanceM(place.coordinates, osm.coordinates) : null;
    const fromCentroid = centroid ? distanceM(centroid, osm.coordinates) : null;
    const flags = [];
    if (fromFile === null) flags.push('no coordinates in the file');
    else if (fromFile > FILE_TOLERANCE_M) flags.push(`file is ${fromFile.toFixed(1)} m away`);
    if (fromCentroid !== null && fromCentroid > CENTROID_REVIEW_M) flags.push(`Nominatim centroid ${fromCentroid.toFixed(0)} m away (area, review)`);
    if (fromFile === null || fromFile > FILE_TOLERANCE_M) problems += 1;
    console.log(
      `${flags.length ? 'CHECK' : 'OK   '}  ${place.osmId.padEnd(22)} ${osm.coordinates[1]},${osm.coordinates[0]}  ${place.name}` +
        `  (OSM: ${osm.tags.name || '-'})${flags.length ? `  <- ${flags.join('; ')}` : ''}`
    );
    return { ...place, coordinates: osm.coordinates, osmTags: osm.tags };
  });
  return { problems, places: verified };
}

const keptTags = (tags = {}) => Object.fromEntries(KEPT_TAGS.filter((key) => tags[key]).map((key) => [key, String(tags[key])]));

/**
 * Add / update the places in a database
 * @param {import('mongodb').Db} db
 * @param {Array<Object>} places - from the file (coordinates required)
 * @param {{ apply?: boolean }} [options]
 */
export async function migratePlaces(db, places, { apply = false } = {}) {
  const col = db.collection('places_cache');
  const existing = new Map(
    (await col.find({ osmId: { $in: places.map((p) => p.osmId) } }).toArray()).map((doc) => [doc.osmId, doc])
  );
  const toInsert = [];
  const toUpdate = [];
  const unchanged = [];
  for (const place of places) {
    if (!Array.isArray(place.coordinates)) throw new Error(`${place.osmId} has no coordinates: run --verify --write-json first`);
    const doc = existing.get(place.osmId);
    if (!doc) {
      toInsert.push(place);
      continue;
    }
    const moved = distanceM(doc.coordinates?.coordinates || [0, 0], place.coordinates) > MOVE_THRESHOLD_M;
    const renamed = doc.name !== place.name || doc.address !== place.address || doc.placeType !== place.placeType;
    if (moved || renamed || doc.source !== PLACE_SOURCES.MANUAL) toUpdate.push({ place, doc, moved });
    else unchanged.push(place);
  }

  console.log(`Places in the file: ${places.length}`);
  console.log(`To add: ${toInsert.length}`);
  toInsert.forEach((p) => console.log(`  + ${p.osmId.padEnd(22)} ${p.placeType.padEnd(13)} ${p.name}`));
  console.log(`To update: ${toUpdate.length}`);
  toUpdate.forEach(({ place, doc, moved }) =>
    console.log(`  ~ ${place.osmId.padEnd(22)} ${place.name}${moved ? ` (moved ${distanceM(doc.coordinates.coordinates, place.coordinates).toFixed(1)} m)` : ''}`)
  );
  console.log(`Already up to date: ${unchanged.length}`);
  if (!apply) return { inserted: toInsert.length, updated: toUpdate.length, unchanged: unchanged.length };

  const now = new Date();
  const point = (place) => ({ type: 'Point', coordinates: place.coordinates });
  await col.bulkWrite(
    [
      ...toInsert.map((place) => ({
        updateOne: {
          filter: { osmId: place.osmId },
          update: {
            $setOnInsert: {
              osmId: place.osmId,
              source: PLACE_SOURCES.MANUAL,
              name: place.name,
              address: place.address,
              placeType: place.placeType,
              coordinates: point(place),
              openingHours: place.openingHours || DEFAULT_OPENING_HOURS[place.placeType] || '',
              phone: place.phone || '',
              website: place.website || '',
              tags: place.tags || {},
              attractions: [],
              lastFetchedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      ...toUpdate.map(({ place }) => ({
        updateOne: {
          filter: { osmId: place.osmId },
          update: {
            $set: {
              source: PLACE_SOURCES.MANUAL,
              name: place.name,
              address: place.address,
              placeType: place.placeType,
              coordinates: point(place),
              updatedAt: now,
            },
          },
        },
      })),
    ],
    { ordered: false }
  );
  await col.createIndex({ coordinates: '2dsphere' });
  console.log(`Done. Added ${toInsert.length}, updated ${toUpdate.length}.`);
  return { inserted: toInsert.length, updated: toUpdate.length, unchanged: unchanged.length };
}

async function main() {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore if not allowed
  }
  dotenv.config();
  const file = readPlacesFile();
  validatePlaces(file.places);

  if (process.argv.includes('--verify')) {
    const { problems, places } = await verifyPlaces(file.places);
    if (process.argv.includes('--write-json')) {
      const written = places.map(({ osmTags, ...place }) => ({
        ...place,
        // OpenStreetMap tags that tell what the place offers, and its contact details when it has them
        tags: keptTags(osmTags),
        ...(osmTags?.opening_hours ? { openingHours: osmTags.opening_hours } : {}),
        ...(osmTags?.phone || osmTags?.['contact:phone'] ? { phone: osmTags.phone || osmTags['contact:phone'] } : {}),
        ...(osmTags?.website || osmTags?.['contact:website'] ? { website: osmTags.website || osmTags['contact:website'] } : {}),
      }));
      fs.writeFileSync(
        DATA_FILE,
        `${JSON.stringify({ ...file, verifiedAt: new Date().toISOString().slice(0, 10), places: written }, null, 2)}\n`
      );
      console.log(`\nWrote the OpenStreetMap coordinates of ${written.length} places into ${DATA_FILE}`);
    } else {
      console.log(problems ? `\n${problems} place(s) differ from OpenStreetMap: run with --write-json to fix the file` : '\nThe file matches OpenStreetMap.');
      if (problems) process.exitCode = 1;
    }
    return;
  }

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not defined in .env');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = argValue('db');
  const db = dbName ? mongoose.connection.client.db(dbName) : mongoose.connection.db;
  console.log(`Target database: ${db.databaseName}`);
  console.log(apply ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no changes written)\n');
  await migratePlaces(db, file.places, { apply });
  if (!apply) console.log('\nRe-run with --apply to write the changes.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
