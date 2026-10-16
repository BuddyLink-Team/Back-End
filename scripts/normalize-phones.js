/**
 * One-off migration: rewrite every stored User.phone to E.164 (+84...), the format
 * the backend now stores and looks up (see src/shared/helpers/phone.helper.js).
 *
 * Usage:
 *   node scripts/normalize-phones.js           # dry run, prints the planned changes
 *   node scripts/normalize-phones.js --apply   # writes the changes
 *
 * Numbers that would collide with another user's number after normalization are
 * skipped and reported, so the unique index on phone is never violated.
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import User from '../src/modules/user/user.model.js';
import { normalizePhone } from '../src/shared/helpers/phone.helper.js';

const apply = process.argv.includes('--apply');

async function main() {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore if not allowed
  }

  dotenv.config();
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not defined in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Target database: ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(apply ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no changes written)\n');

  // Include soft-deleted users: the unique index on phone covers them too
  const users = await User.find({ phone: { $exists: true, $ne: null } }, { phone: 1, email: 1 }).lean();

  const ownersByPhone = new Map();
  for (const user of users) {
    const key = normalizePhone(user.phone);
    if (!ownersByPhone.has(key)) ownersByPhone.set(key, []);
    ownersByPhone.get(key).push(user);
  }

  const updates = [];
  const conflicts = [];
  for (const [normalized, owners] of ownersByPhone) {
    const pending = owners.filter((user) => user.phone !== normalized);
    if (pending.length === 0) continue;
    if (owners.length > 1) {
      conflicts.push({ normalized, owners });
      continue;
    }
    updates.push({ user: pending[0], normalized });
  }

  console.log(`Users with a phone: ${users.length}`);
  console.log(`Already normalized: ${users.filter((u) => u.phone === normalizePhone(u.phone)).length}`);
  console.log(`To update: ${updates.length}`);
  updates.forEach(({ user, normalized }) => console.log(`  ${user.email}: ${user.phone} -> ${normalized}`));

  if (conflicts.length > 0) {
    console.log(`\nSkipped (same number on several users, resolve manually): ${conflicts.length}`);
    conflicts.forEach(({ normalized, owners }) => {
      console.log(`  ${normalized}: ${owners.map((u) => `${u.email} (${u.phone})`).join(', ')}`);
    });
  }

  if (!apply || updates.length === 0) return;

  const result = await User.bulkWrite(
    updates.map(({ user, normalized }) => ({
      updateOne: { filter: { _id: user._id, phone: user.phone }, update: { $set: { phone: normalized } } },
    }))
  );
  console.log(`\nUpdated ${result.modifiedCount} users.`);
}

main()
  .catch((error) => {
    console.error('Phone normalization failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
