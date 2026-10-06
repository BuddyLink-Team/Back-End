import { describe, it, expect, beforeAll } from '@jest/globals';
import mongoose from 'mongoose';
import Conversation from '../../src/modules/chat/conversation.model.js';

describe('Conversation model uniqueness (pairKey)', () => {
  const parentA = new mongoose.Types.ObjectId();
  const parentB = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    // Make sure indexes match the current schema (drops a legacy non-unique pairKey_1 if present)
    await Conversation.syncIndexes();
  });

  it('should build pairKey as a unique index', async () => {
    const indexes = await Conversation.collection.indexes();
    const pairKeyIndex = indexes.find((index) => index.key?.pairKey === 1);

    expect(pairKeyIndex).toBeDefined();
    expect(pairKeyIndex.unique).toBe(true);
  });

  it('should reject a second active direct conversation for the same pair in reverse order', async () => {
    await Conversation.create({ type: 'direct', participants: [parentA, parentB] });

    await expect(
      Conversation.create({ type: 'direct', participants: [parentB, parentA] })
    ).rejects.toMatchObject({ code: 11000 });
  });
});
