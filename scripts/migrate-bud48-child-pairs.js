/**
 * One-off migration for BUD-48 (child pairing). Run once right after deploying, safe to run again.
 *
 * 1. Swipes: drop the old unique index { swiperParentId, targetChildId } (it stops a parent from liking
 *    the same child for a second own child) and build the new { swiperParentId, forChildId, targetChildId }.
 * 2. Swipes without forChildId: set it when the swiper has exactly one active child. Parents with several
 *    children are skipped on purpose (we don't guess which child a swipe was for).
 * 3. Pending / accepted connections: add a child pair (source 'discovery') for every Like swipe between
 *    the two parents that has a forChildId.
 *
 * Usage:
 *   node scripts/migrate-bud48-child-pairs.js           # dry run, prints the planned changes
 *   node scripts/migrate-bud48-child-pairs.js --apply   # writes the changes
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import Swipe from '../src/modules/discovery/discovery.model.js';
import Child from '../src/modules/child/child.model.js';
import Connection from '../src/modules/connection/connection.model.js';
import {
  CONNECTION_STATUS,
  CHILD_PAIR_SOURCES,
  buildChildPairKey,
} from '../src/modules/connection/connection.constants.js';

const LEGACY_SWIPE_INDEX = 'swiperParentId_1_targetChildId_1';

/**
 * @param {{ apply?: boolean, log?: (message: string) => void }} [options]
 * @returns {Promise<{ legacyIndexDropped: boolean, swipesBackfilled: number, swipesSkipped: number, pairsCreated: number }>}
 */
export const migrateChildPairs = async ({ apply = false, log = () => {} } = {}) => {
  const result = { legacyIndexDropped: false, swipesBackfilled: 0, swipesSkipped: 0, pairsCreated: 0 };

  // 1. Swipe indexes
  const indexes = await Swipe.collection.indexes().catch(() => []);
  if (indexes.some((index) => index.name === LEGACY_SWIPE_INDEX)) {
    if (apply) await Swipe.collection.dropIndex(LEGACY_SWIPE_INDEX);
    result.legacyIndexDropped = true;
  }
  if (apply) await Swipe.syncIndexes();

  // 2. Backfill forChildId for parents with exactly one active child
  const legacySwipes = await Swipe.find({ forChildId: null }).select('_id swiperParentId').lean();
  const swiperIds = [...new Set(legacySwipes.map((swipe) => swipe.swiperParentId.toString()))];
  const activeChildren = await Child.find({ parentId: { $in: swiperIds }, isArchived: false }).select('_id parentId').lean();
  const childrenByParent = new Map();
  for (const child of activeChildren) {
    const key = child.parentId.toString();
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(child._id);
  }

  for (const swipe of legacySwipes) {
    const children = childrenByParent.get(swipe.swiperParentId.toString()) || [];
    if (children.length !== 1) {
      result.swipesSkipped += 1;
      continue;
    }
    if (apply) {
      try {
        await Swipe.updateOne({ _id: swipe._id, forChildId: null }, { $set: { forChildId: children[0] } });
      } catch (error) {
        // The same (child, target) swipe already exists: keep the legacy one as it is
        if (error.code !== 11000) throw error;
        result.swipesSkipped += 1;
        continue;
      }
    }
    result.swipesBackfilled += 1;
  }

  // 3. Child pairs on pending / accepted connections
  const likes = apply
    ? await Swipe.find({ isLike: true, forChildId: { $ne: null } }).lean()
    : // Dry run: the backfill above was not written, simulate it
      (await Swipe.find({ isLike: true }).lean())
        .map((swipe) => {
          if (swipe.forChildId) return swipe;
          const children = childrenByParent.get(swipe.swiperParentId.toString()) || [];
          return children.length === 1 ? { ...swipe, forChildId: children[0] } : null;
        })
        .filter(Boolean);

  const plannedKeys = new Set();
  for (const swipe of likes) {
    const connection = await Connection.findOne({
      parents: { $all: [swipe.swiperParentId, swipe.targetParentId] },
      status: { $in: [CONNECTION_STATUS.PENDING, CONNECTION_STATUS.ACCEPTED] },
    })
      .select('_id childPairs.pairKey')
      .lean();
    if (!connection) continue;

    const pairKey = buildChildPairKey(swipe.forChildId, swipe.targetChildId);
    const planKey = `${connection._id}:${pairKey}`;
    if (plannedKeys.has(planKey)) continue;
    plannedKeys.add(planKey);
    if ((connection.childPairs || []).some((pair) => pair.pairKey === pairKey)) continue;

    if (apply) {
      const updated = await Connection.updateOne(
        { _id: connection._id, 'childPairs.pairKey': { $ne: pairKey } },
        {
          $push: {
            childPairs: {
              childIds: [swipe.forChildId.toString(), swipe.targetChildId.toString()].sort(),
              pairKey,
              source: CHILD_PAIR_SOURCES.DISCOVERY,
              matchScore: null,
              createdAt: swipe.createdAt || new Date(),
            },
          },
        }
      );
      if (updated.modifiedCount === 0) continue;
    }
    result.pairsCreated += 1;
  }

  log(`Legacy swipe index ${result.legacyIndexDropped ? 'dropped' : 'not present'}`);
  log(`Swipes backfilled with forChildId: ${result.swipesBackfilled}`);
  log(`Swipes skipped (parent has 0 or several children): ${result.swipesSkipped}`);
  log(`Child pairs created: ${result.pairsCreated}`);
  return result;
};

async function main() {
  const apply = process.argv.includes('--apply');
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

  await migrateChildPairs({ apply, log: console.log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('BUD-48 child pair migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
