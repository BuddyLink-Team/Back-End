/**
 * Run the API against an in-memory MongoDB filled with the demo seed (scripts/seed.js).
 * Nothing touches the database in .env: data lives only while this process runs.
 *
 * Usage:
 *   npm run dev:memory
 *   npm run dev:memory -- --sync-places            # also load Đà Nẵng places from OpenStreetMap
 *   npm run dev:memory -- --sync-places=ha-noi     # another area of PLACES_SYNC_AREAS
 *
 * The places sync runs in the background after the server starts (public Overpass can take minutes);
 * the seed already has 10 places, the others appear as cells finish.
 */
/* eslint-disable no-console -- CLI script output */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const DB_NAME = 'buddylink_dev';

const mongod = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });
// Must be set before src/config/env.js is loaded (it reads MONGODB_URI once)
process.env.MONGODB_URI = mongod.getUri(DB_NAME);
console.log(`In-memory MongoDB: ${process.env.MONGODB_URI}`);

const { seedDatabase, SEED_PASSWORD } = await import('./seed.js');

// Seed first: the server then only adds what is missing (subscription plans, places cache)
await mongoose.connect(process.env.MONGODB_URI);
const counts = await seedDatabase();
console.table(counts);
await mongoose.disconnect();
console.log(`All accounts use the password: ${SEED_PASSWORD} (admin: admin@buddylink.vn)`);

const shutdown = async () => {
  await mongoose.disconnect().catch(() => {});
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await import('../src/server.js');

const syncArg = process.argv.find((arg) => arg === '--sync-places' || arg.startsWith('--sync-places='));
if (syncArg) {
  const { syncPlaces, resolveSyncArea } = await import('./sync-places.js');
  const areaKey = syncArg.includes('=') ? syncArg.split('=')[1] : 'da-nang';
  // Wait for the server's own connection, then sync without blocking requests
  mongoose.connection
    .asPromise()
    .then(() => syncPlaces(resolveSyncArea({ area: areaKey })))
    .catch((error) => console.error('Places sync failed:', error.message));
}
