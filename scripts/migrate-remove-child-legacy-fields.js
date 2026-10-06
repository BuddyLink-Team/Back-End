/**
 * Remove legacy child fields (avatarUrl, schoolLevel, privacySettings) that were dropped from
 * the Child schema.
 *
 * Usage:
 *   node scripts/migrate-remove-child-legacy-fields.js                       # dry run: count only
 *   node scripts/migrate-remove-child-legacy-fields.js --apply --backup=<file> # back up, then $unset
 */
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

// Ensure Google DNS is used for SRV resolution on Node on Windows
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if not allowed
}

dotenv.config();

const LEGACY_FIELDS = ['avatarUrl', 'schoolLevel', 'privacySettings'];

const args = process.argv.slice(2);
const shouldApply = args.includes('--apply');
const backupArg = args.find((arg) => arg.startsWith('--backup='));
const backupPath = backupArg ? path.resolve(backupArg.slice('--backup='.length)) : null;

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not defined in .env');
  process.exit(1);
}

if (shouldApply && !backupPath) {
  console.error('--apply requires --backup=<file> so removed values can be restored');
  process.exit(1);
}

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  const children = mongoose.connection.db.collection('children');

  const filter = { $or: LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } })) };
  const projection = Object.fromEntries([['_id', 1], ...LEGACY_FIELDS.map((field) => [field, 1])]);

  const affected = await children.find(filter, { projection }).toArray();
  console.log(`Database: ${mongoose.connection.name}`);
  console.log(`Children with legacy fields: ${affected.length}`);
  LEGACY_FIELDS.forEach((field) => {
    const count = affected.filter((doc) => doc[field] !== undefined).length;
    console.log(`  - ${field}: ${count}`);
  });

  if (!shouldApply) {
    console.log('Dry run only. Re-run with --apply --backup=<file> to remove the fields.');
    return;
  }

  if (affected.length === 0) {
    console.log('Nothing to remove.');
    return;
  }

  fs.writeFileSync(backupPath, JSON.stringify(affected, null, 2));
  console.log(`Backup written: ${backupPath}`);

  const unset = Object.fromEntries(LEGACY_FIELDS.map((field) => [field, '']));
  const result = await children.updateMany(filter, { $unset: unset });
  console.log(`Updated children: ${result.modifiedCount}`);
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
