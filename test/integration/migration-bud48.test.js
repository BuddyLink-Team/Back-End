import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import mongoose from 'mongoose';
import Swipe from '../../src/modules/discovery/discovery.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import { migrateChildPairs } from '../../scripts/migrate-bud48-child-pairs.js';

const { ObjectId } = mongoose.Types;

// The migration reads every swipe: run it on its own database, not the one shared by the other suites
describe('BUD-48 child pair migration', () => {
  beforeAll(async () => {
    await mongoose.disconnect();
    await mongoose.connect('mongodb://127.0.0.1:27018/bud48_migration');
    await mongoose.connection.dropDatabase();
    // Production state before the deploy: the old unique index only
    await Swipe.collection.createIndex({ swiperParentId: 1, targetChildId: 1 }, { unique: true });
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
  });

  it('backfills single-child swipes, skips ambiguous ones, creates pairs and is idempotent', async () => {
    const [single, multi, target, other] = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
    const child = (parentId, displayName, extra = {}) =>
      Child.create({ parentId, displayName, dateOfBirth: new Date('2020-01-01'), gender: 'boy', ...extra });

    const singleKid = await child(single, 'Only');
    await child(single, 'Archived', { isArchived: true });
    await Promise.all([child(multi, 'One'), child(multi, 'Two')]);
    const targetKid = await child(target, 'Target');
    const otherKid = await child(other, 'Other');

    const rawSwipe = (swiperParentId, targetChild, isLike) => ({
      swiperParentId,
      targetChildId: targetChild._id,
      targetParentId: targetChild.parentId,
      isLike,
      createdAt: new Date(),
    });
    await Swipe.collection.insertMany([
      rawSwipe(single, targetKid, true),
      rawSwipe(single, otherKid, false),
      rawSwipe(multi, targetKid, true),
    ]);

    const singleConnection = await Connection.create({ parents: [single, target], requesterId: single, recipientId: target });
    const multiConnection = await Connection.create({
      parents: [multi, target],
      requesterId: multi,
      recipientId: target,
      status: 'accepted',
    });

    const dryRun = await migrateChildPairs();
    expect(dryRun).toEqual({ legacyIndexDropped: true, swipesBackfilled: 2, swipesSkipped: 1, pairsCreated: 1 });
    expect(await Swipe.countDocuments({ forChildId: null })).toBe(3);

    const first = await migrateChildPairs({ apply: true });
    expect(first).toEqual({ legacyIndexDropped: true, swipesBackfilled: 2, swipesSkipped: 1, pairsCreated: 1 });

    const indexNames = (await Swipe.collection.indexes()).map((index) => index.name);
    expect(indexNames).not.toContain('swiperParentId_1_targetChildId_1');
    expect(indexNames).toContain('swiperParentId_1_forChildId_1_targetChildId_1');

    const backfilled = await Swipe.find({ swiperParentId: single }).lean();
    backfilled.forEach((swipe) => expect(swipe.forChildId.toString()).toBe(singleKid._id.toString()));
    // Legacy swipes have no forChildId field at all; ambiguous ones stay that way
    expect((await Swipe.findOne({ swiperParentId: multi }).lean()).forChildId ?? null).toBeNull();

    const paired = await Connection.findById(singleConnection._id).lean();
    expect(paired.childPairs).toHaveLength(1);
    expect(paired.childPairs[0]).toMatchObject({ source: 'discovery', matchScore: null });
    expect(paired.childPairs[0].pairKey).toBe([singleKid._id.toString(), targetKid._id.toString()].sort().join('_'));
    expect((await Connection.findById(multiConnection._id).lean()).childPairs).toHaveLength(0);

    // Second run: nothing left to do
    const second = await migrateChildPairs({ apply: true });
    expect(second).toEqual({ legacyIndexDropped: false, swipesBackfilled: 0, swipesSkipped: 1, pairsCreated: 0 });
    expect((await Connection.findById(singleConnection._id).lean()).childPairs).toHaveLength(1);
  });
});
